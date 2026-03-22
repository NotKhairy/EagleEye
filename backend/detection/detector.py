import cv2
from deep_sort_realtime.deepsort_tracker import DeepSort
import json
from ultralytics import YOLO
import time

class ObjectDetector:
    """Handles YOLO detection + DeepSORT tracking and object-zone matching."""
    
    with open("config/global_config.json", "r") as f:
        _config_data = json.load(f)
        # Handle both list and dict formats
        global_config = _config_data[0] if isinstance(_config_data, list) else _config_data

    def __init__(self, model_path="yolov8n.pt", confidence=0.5, trigger_cooldown_seconds=5):
        self.model = YOLO(model_path)
        self.confidence = confidence
        self.tracker = DeepSort(max_age=30, n_init=3)
        self.trigger_cooldown_seconds = trigger_cooldown_seconds
        # key: (zone_id, track_id), value: last trigger timestamp
        self.last_trigger_times = {}
    
    def clear_trigger_times(self):
        """Clear all trigger cooldown times to allow immediate re-triggering on reset."""
        self.last_trigger_times.clear()
        print("[INFO] Trigger cooldown times cleared")
    
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
    
    def handle_trigger(self, zone, detection):
        """Handle trigger actions based on global config settings."""
        Action = self.global_config.get("Action", {})
        
        # Check desktopPush
        if Action.get("desktopPush"):
            self._handle_desktop_push(zone, detection)
        
        # Check email
        email = Action.get("email")
        if email:
            self._handle_email(zone, detection, email)
        
        # Check saveSnapshotLocally
        if Action.get("saveSnapshotLocally"):
            self._handle_save_snapshot(zone, detection)
        
        # Check SMS
        sms_number = Action.get("SMS")
        if sms_number:
            self._handle_sms(zone, detection, sms_number)
        
        # Check CALL
        call_number = Action.get("CALL")
        if call_number:
            self._handle_call(zone, detection, call_number)
    
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
    
    def _handle_email(self, zone, detection, email_address):
        """Send email notification."""
        print(f"[MOCK - email] Sending email to {email_address} for zone '{zone['name']}' - {detection['label']} ID: {detection['track_id']}")
    
    def _handle_save_snapshot(self, zone, detection):
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
    
    def check_objects_in_zones(self, tracked_objects, zone_manager):
        """Trigger each zone when matching objects enter it."""
        zone_manager.reset_triggers()

        triggered_zones = set()

        for zone in zone_manager.zones:
            for detection in tracked_objects:
                in_zone = zone_manager._is_point_in_coordinates(detection["center"], zone["coordinates"])
                if in_zone and zone_manager.zone_matches_label(zone, detection["label"]):
                    zone_manager.set_zone_triggered(zone["id"], True)
                    triggered_zones.add(zone["id"])
                    trigger_key = (zone["id"], detection["track_id"])
                    now = time.time()
                    last_time = self.last_trigger_times.get(trigger_key, 0)

                    # Allow one trigger per object per zone within the cooldown window.
                    if now - last_time >= self.trigger_cooldown_seconds:
                        self.last_trigger_times[trigger_key] = now
                        action_text = zone.get("onTrigger", "No action defined")
                        print(
                            f"Zone '{zone['name']}' triggered by {detection['label']} "
                            f"(ID: {detection['track_id']}), {action_text}"
                        )

                        self.handle_trigger(zone, detection)
                    
                    break
        
        return len(triggered_zones) > 0
