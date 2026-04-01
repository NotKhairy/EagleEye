import cv2
from deep_sort_realtime.deepsort_tracker import DeepSort
import json
from ultralytics import YOLO
import time
import smtplib
from mailService import MailService


def _bgr_face_crop_from_person_bbox(frame, x1, y1, x2, y2):
    """
    YOLO person boxes are full-body; faces are usually in the upper band.
    Crop top ~55% with horizontal padding so MTCNN sees a larger face.
    """
    if frame is None or frame.size == 0:
        return None
    h, w = frame.shape[:2]
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(w, int(x2)), min(h, int(y2))
    if x2 <= x1 or y2 <= y1:
        return None
    bw = x2 - x1
    bh = y2 - y1
    band = max(int(bh * 0.55), int(bw * 0.65))
    y_face_end = min(y2, y1 + band)
    pad_x = int(bw * 0.15)
    fx1 = max(0, x1 - pad_x)
    fx2 = min(w, x2 + pad_x)
    crop = frame[y1:y_face_end, fx1:fx2]
    if crop.size == 0:
        return None
    return crop


class ObjectDetector:
    """Handles YOLO detection + DeepSORT tracking and object-zone matching."""

    def __init__(self, model_path="yolov8n.pt", confidence=0.5, trigger_cooldown_seconds=5):
        self.model = YOLO(model_path)
        self.confidence = confidence
        self.tracker = DeepSort(max_age=30, n_init=3)
        self.trigger_cooldown_seconds = trigger_cooldown_seconds
        # key: (zone_id, track_id), value: boolean indicating if object is currently in zone
        self.zone_object_states = {}
        self.mail_service = MailService()
        self.global_config = self._load_global_config()
    
    def _load_global_config(self):
        """Load global config at runtime, not at class definition time."""
        try:
            with open("config/global_config.json", "r") as f:
                config_data = json.load(f)
                # Handle both list and dict formats
                return config_data[0] if isinstance(config_data, list) else config_data
        except Exception as e:
            print(f"[WARNING] Failed to load global config: {e}")
            return {}
    
    def clear_zone_states(self):
        """Clear all zone-object state tracking to reset on video restart."""
        self.zone_object_states.clear()
        print("[INFO] Zone-object states cleared")
    
    def track(self, frame):
        """Run YOLO detection, then DeepSORT tracking for persistent IDs."""
        results = self.model(frame, verbose=False, conf=self.confidence)
        yolo_result = results[0]

        deepsort_detections = []
        if len(yolo_result.boxes) > 0:
            for i, box in enumerate(yolo_result.boxes.xyxy):
                x1, y1, x2, y2 = box.tolist()
                w = x2 - x1
                h = y2 - y1
                conf = float(yolo_result.boxes.conf[i])
                class_id = int(yolo_result.boxes.cls[i])
                label = str(self.model.names.get(class_id, str(class_id))).lower()

                # DeepSORT expects: ([left, top, width, height], confidence, class_name)
                deepsort_detections.append(([x1, y1, w, h], conf, label))

        tracks = self.tracker.update_tracks(deepsort_detections, frame=frame)

        tracked_objects = []
        for track in tracks:
            if not track.is_confirmed() or track.time_since_update > 1:
                continue

            ltrb = track.to_ltrb()
            x1, y1, x2, y2 = map(int, ltrb)
            label = "object"
            if track.det_class is not None:
                label = str(track.det_class).lower()

            tracked_objects.append(
                {
                    "track_id": int(track.track_id),
                    "label": label,
                    "bbox": (x1, y1, x2, y2),
                    "center": self.get_box_center((x1, y1, x2, y2)),
                    "confidence": float(track.det_conf) if track.det_conf is not None else 0.0,
                }
            )

        return tracked_objects
    
    def handle_trigger(self, zone, detection, snapshot=None):
        """Handle trigger actions based on global config settings."""
        # Load fresh config each time to get latest updates
        global_config = self._load_global_config()
        Action = global_config.get("Action", {})
        print(Action)
        
        # Check desktopPush
        if Action.get("desktopPush"):
            print("here 1")
            self._handle_desktop_push(zone, detection)
        
        # Check email
        email = Action.get("emailDigest")
        if email:
            print("here 2")
            self._handle_email(zone, detection, email, snapshot)
        
        # Check saveSnapshotLocally
        if Action.get("saveSnapshotLocally"):
            self._handle_save_snapshot(zone, detection, snapshot)
        
        # Check SMS
        sms_number = Action.get("SMS")
        if sms_number:
            self._handle_sms(zone, detection, sms_number)
        
        # Check CALL
        call_number = Action.get("CALL")
        if call_number:
            self._handle_call(zone, detection, call_number)
    
    def execute_trigger_events(self, trigger_events, snapshot_path=None):
        """
        Execute all collected trigger events with an optional snapshot.
        Call this AFTER the annotated frame has been saved.
        
        Args:
            trigger_events: List of trigger event dicts from check_objects_in_zones
            snapshot_path: Path to the saved annotated frame snapshot
        """
        for event in trigger_events:
            self.handle_trigger(event["zone"], event["detection"], snapshot_path)
    
    def _handle_desktop_push(self, zone, detection):
        """Send a desktop push notification."""
        try:
            from win10toast import ToastNotifier
            toaster = ToastNotifier()
            message = f"Zone '{zone['name']}' triggered by {detection['label']} (ID: {detection['track_id']})"
            toaster.show_toast(
                title="EagleEye Detection Alert",
                msg=message,
                duration=5,
                threaded=True
            )
        except ImportError:
            print("[MOCK - desktopPush] win10toast not installed. Install with: pip install win10toast")
            print(f"[MOCK - desktopPush] Zone '{zone['name']}' - {detection['label']} ID: {detection['track_id']}")
    
    def _handle_email(self, zone, detection, email_address, snapshot):
        self.mail_service.send_email(
            recipient_email=email_address,
            subject=f"EagleEye Alert: Zone '{zone['name']}' Triggered",
            body=f"Zone '{zone['name']}' was triggered by {detection['label']} (ID: {detection['track_id']})",
            attachments=[snapshot] if snapshot else None
        )
        print("Success!")

    
    def _handle_save_snapshot(self, zone, detection, snapshot):
        """Save snapshot locally."""
        print(f"[MOCK - saveSnapshotLocally] Saving snapshot for zone '{zone['name']}' - {detection['label']} ID: {detection['track_id']}")
    
    def _handle_sms(self, zone, detection, phone_number):
        """Send SMS notification."""
        print(f"[MOCK - SMS] Sending SMS to {phone_number} for zone '{zone['name']}' - {detection['label']} ID: {detection['track_id']}")
    
    def _handle_call(self, zone, detection, phone_number):
        """Make phone call notification."""
        print(f"[MOCK - CALL] Calling {phone_number} for zone '{zone['name']}' - {detection['label']} ID: {detection['track_id']}")
        

            
    
    def get_box_center(self, box):
        """Calculate the center point of a bounding box"""
        x = (box[0] + box[2]) / 2
        y = (box[1] + box[3]) / 2
        return (x, y)
    
    def draw_tracks(self, frame, tracked_objects, font_scale=0.4, line_width=1):
        """Draw tracked objects (bbox + label + track id + confidence)."""
        annotated = frame.copy()
        for obj in tracked_objects:
            x1, y1, x2, y2 = obj["bbox"]
            label_text = f"{obj['label']} {obj['track_id']} {obj['confidence']:.2f}"

            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), line_width)
            text_origin = (x1, max(18, y1 - 8))
            cv2.putText(
                annotated,
                label_text,
                text_origin,
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                (0, 255, 0),
                line_width,
                cv2.LINE_AA,
            )
        return annotated
    
    def check_objects_in_zones(self, tracked_objects, zone_manager, frame=None, face_recognizer=None):
        """
        Check if objects are in zones and collect trigger events based on state changes.
        Uses enter/exit rules instead of cooldown timers.
        DOES NOT execute triggers - returns them for later execution after frame annotation.
        """
        zone_manager.reset_triggers()

        triggered_zones = set()
        trigger_events = []  # Collect triggers to execute later
        current_states = {}  # Track current frame's states

        for zone in zone_manager.zones:
            rule = zone.get("rule", "").lower()  # "enter", "exit", or ""
            identity_rule = zone.get("personIdentity") or None
            
            for detection in tracked_objects:
                in_zone = zone_manager._is_point_in_coordinates(detection["center"], zone["coordinates"])
                
                if in_zone and zone_manager.zone_matches_label(zone, detection["label"]):
                    zone_manager.set_zone_triggered(zone["id"], True)
                    triggered_zones.add(zone["id"])
                    
                    state_key = (zone["id"], detection["track_id"])
                    previous_state = self.zone_object_states.get(state_key, False)
                    current_states[state_key] = True
                    
                    # Trigger on state transitions based on rule
                    should_trigger = False
                    if rule == "enter" and not previous_state and in_zone:
                        # Object just entered the zone
                        should_trigger = True
                        trigger_reason = "entered"
                    elif rule == "exit":
                        # Will handle exit triggers below after processing all objects
                        pass
                    elif rule == "":
                        # No rule specified, trigger every frame (legacy behavior)
                        should_trigger = True
                    
                    if should_trigger:
                        # Optional identity filter (only applies when zone triggers for person)
                        if (
                            identity_rule
                            and detection.get("label", "").lower() == "person"
                            and frame is not None
                            and face_recognizer is not None
                        ):
                            mode = str(identity_rule.get("mode", "")).lower()
                            allowed_ids = set(identity_rule.get("personIds") or [])
                            if mode in ("whitelist", "blacklist") and allowed_ids:
                                x1, y1, x2, y2 = detection.get("bbox", (0, 0, 0, 0))
                                crop = _bgr_face_crop_from_person_bbox(frame, x1, y1, x2, y2)
                                match = face_recognizer.identify_bgr(crop) if crop is not None else None
                                matched_id = match.person_id if match else None
                                detection = {**detection}
                                detection["face_person_id"] = matched_id
                                detection["face_person_name"] = match.person_name if match else None
                                detection["face_distance"] = float(match.distance) if match else None

                                if mode == "whitelist":
                                    # Trigger if NOT recognized as one of the allowed people
                                    if matched_id in allowed_ids:
                                        should_trigger = False
                                elif mode == "blacklist":
                                    # Trigger if recognized as one of the blocked people
                                    if matched_id not in allowed_ids:
                                        should_trigger = False

                                print(
                                    f"[face] zone={zone.get('name')} mode={mode} "
                                    f"track={detection.get('track_id')} "
                                    f"matched_id={matched_id} dist={detection.get('face_distance')} "
                                    f"trigger_after_identity={should_trigger}"
                                )

                        # Identity filter may set should_trigger False; only enqueue if still True.
                        if should_trigger:
                            now = time.time()
                            print(
                                f"Zone '{zone['name']}' {trigger_reason} by {detection['label']} "
                                f"(ID: {detection['track_id']})"
                            )
                            trigger_events.append({
                                "zone": zone,
                                "detection": detection,
                                "timestamp": now
                            })
                    
                    break

        # Handle exit triggers - check for objects that were in zone but are no longer there
        for state_key, was_in_zone in list(self.zone_object_states.items()):
            if was_in_zone and state_key not in current_states:
                # Object was in zone previously but is not in current_states
                zone_id, track_id = state_key
                zone = next((z for z in zone_manager.zones if z["id"] == zone_id), None)
                
                if zone:
                    rule = zone.get("rule", "").lower()
                    if rule == "exit":
                        # Find the detection to get label for logging
                        detection = next(
                            (d for d in tracked_objects if d["track_id"] == track_id),
                            None
                        )
                        label = detection["label"] if detection else "unknown"
                        
                        now = time.time()
                        print(
                            f"Zone '{zone['name']}' exited by {label} "
                            f"(ID: {track_id})"
                        )
                        # Create a synthetic detection for exit event
                        exit_detection = {
                            "track_id": track_id,
                            "label": label,
                            "bbox": (0, 0, 0, 0),
                            "center": (0, 0),
                            "confidence": 0.0,
                        }
                        trigger_events.append({
                            "zone": zone,
                            "detection": exit_detection,
                            "timestamp": now
                        })
        
        # Update state for next frame
        self.zone_object_states = current_states
        
        return {
            "any_triggered": len(triggered_zones) > 0,
            "trigger_events": trigger_events
        }
