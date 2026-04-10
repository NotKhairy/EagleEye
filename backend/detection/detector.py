import cv2
from deep_sort_realtime.deepsort_tracker import DeepSort
import json
from ultralytics import YOLO
import time
from mailService import MailService
import os
import plyer


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
        # Per-zone runtime state:
        # justEntered: detections that entered this frame near border
        # justExited: detections that exited this frame near border
        # inside: list of (detection, elapsed_seconds) for objects currently inside
        self.zone_runtime_state = {}
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
        self.zone_runtime_state.clear()
        print("[INFO] Zone-object states cleared")

    def _point_to_segment_distance(self, point, seg_start, seg_end):
        """Compute shortest Euclidean distance from point to a segment."""
        px, py = float(point[0]), float(point[1])
        x1, y1 = float(seg_start[0]), float(seg_start[1])
        x2, y2 = float(seg_end[0]), float(seg_end[1])

        dx = x2 - x1
        dy = y2 - y1
        if dx == 0 and dy == 0:
            return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5

        t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        proj_x = x1 + t * dx
        proj_y = y1 + t * dy
        return ((px - proj_x) ** 2 + (py - proj_y) ** 2) ** 0.5

    def _distance_to_polygon_border(self, point, polygon):
        """Compute shortest distance from point to polygon border."""
        if polygon is None or len(polygon) < 2:
            return float("inf")

        min_dist = float("inf")
        for i in range(len(polygon)):
            p1 = polygon[i]
            p2 = polygon[(i + 1) % len(polygon)]
            dist = self._point_to_segment_distance(point, p1, p2)
            if dist < min_dist:
                min_dist = dist
        return min_dist

    def _ensure_zone_state(self, zone_id):
        state = self.zone_runtime_state.get(zone_id)
        if state is None:
            state = {
                "justEntered": [],
                "justExited": [],
                "inside": [],
                "inside_map": {},
            }
            self.zone_runtime_state[zone_id] = state
        return state

    def _update_zone_state_for_frame(self, zone, tracked_objects, zone_manager, now, border_threshold=25.0):
        zone_id = zone["id"]
        state = self._ensure_zone_state(zone_id)
        state["justEntered"] = []
        state["justExited"] = []

        inside_map = state["inside_map"]
        seen_ids = set()

        for detection in tracked_objects:
            track_id = detection["track_id"]
            point = detection["center"]
            polygon = zone["coordinates"]
            in_polygon = zone_manager._is_point_in_coordinates(point, polygon)
            near_border = self._distance_to_polygon_border(point, polygon) <= border_threshold

            is_inside = track_id in inside_map
            if (not is_inside) and in_polygon and near_border:
                payload = {
                    "detection": detection,
                    "entered_at": now,
                    "last_seen": now,
                }
                inside_map[track_id] = payload
                state["justEntered"].append(detection)
                seen_ids.add(track_id)
                continue

            if is_inside:
                if in_polygon:
                    inside_map[track_id]["detection"] = detection
                    inside_map[track_id]["last_seen"] = now
                    seen_ids.add(track_id)
                elif near_border:
                    elapsed = now - inside_map[track_id]["entered_at"]
                    exit_detection = dict(detection)
                    exit_detection["time_elapsed_inside"] = elapsed
                    state["justExited"].append(exit_detection)
                    inside_map.pop(track_id, None)

        # Remove stale entries for tracks that disappeared from view.
        stale_seconds = 2.0
        for track_id, payload in list(inside_map.items()):
            if track_id in seen_ids:
                continue
            if now - payload["last_seen"] > stale_seconds:
                inside_map.pop(track_id, None)

        state["inside"] = []
        for payload in inside_map.values():
            elapsed = now - payload["entered_at"]
            enriched = dict(payload["detection"])
            enriched["time_elapsed_inside"] = elapsed
            state["inside"].append((enriched, elapsed))

        # Mirror runtime state onto zone object for easier debugging/introspection.
        zone["justEntered"] = list(state["justEntered"])
        zone["justExited"] = list(state["justExited"])
        zone["inside"] = list(state["inside"])

        return state

    def _load_rules_config(self):
        try:
            with open("config/rules_config.json", "r") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception:
            return []

    def _match_label(self, expected_object, detection):
        expected = str(expected_object or "").strip().lower()
        if not expected:
            return True
        return detection.get("label", "").lower() == expected

    def _evaluate_predicate(self, node, zone_state):
        node_type = str(node.get("type", "")).lower()
        expected_object = node.get("object")
        results = []

        if node_type == "enter":
            for det in zone_state.get("justEntered", []):
                if self._match_label(expected_object, det):
                    results.append(det)

        elif node_type == "exit":
            for det in zone_state.get("justExited", []):
                if self._match_label(expected_object, det):
                    results.append(det)

        elif node_type == "in_zone":
            for det, _ in zone_state.get("inside", []):
                if self._match_label(expected_object, det):
                    results.append(det)

        elif node_type == "loitering":
            threshold = float(node.get("durationSeconds") or 10)
            matched_track_ids = []
            for det, elapsed in zone_state.get("inside", []):
                if elapsed >= threshold and self._match_label(expected_object, det):
                    results.append(det)
                    matched_track_ids.append(det.get("track_id"))

            if results and not bool(node.get("not", False)):
                now = time.time()
                inside_map = zone_state.get("inside_map", {})
                for track_id in matched_track_ids:
                    payload = inside_map.get(track_id)
                    if payload is not None:
                        payload["entered_at"] = now
                        payload["last_seen"] = now

        fired = len(results) > 0
        if bool(node.get("not", False)):
            return (not fired), []

        return fired, results

    def _evaluate_rule_node(self, node):
        if not isinstance(node, dict):
            return False, []

        if "type" in node:
            zone_id = node.get("zoneId")
            if zone_id is None:
                return False, []
            zone_state = self.zone_runtime_state.get(zone_id)
            if zone_state is None:
                return False, []
            return self._evaluate_predicate(node, zone_state)

        operator = str(node.get("operator", "")).upper()
        if operator == "NOT":
            child = node.get("child")
            fired, _ = self._evaluate_rule_node(child)
            return (not fired), []

        children = node.get("children", [])
        if not isinstance(children, list) or len(children) == 0:
            return False, []

        if operator == "AND":
            all_matches = []
            for child in children:
                child_fired, child_matches = self._evaluate_rule_node(child)
                if not child_fired:
                    return False, []
                all_matches.extend(child_matches)
            return True, all_matches

        if operator == "OR":
            for child in children:
                child_fired, child_matches = self._evaluate_rule_node(child)
                if child_fired:
                    return True, child_matches
            return False, []

        return False, []
    
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
    
    def handle_trigger(self, rule_event, snapshot=None):
        """Handle trigger actions assigned by fired rules."""

        actions = [str(a).lower() for a in (rule_event.get("actions") or [])]
        if len(actions) == 0:
            return

        matched_objects = rule_event.get("matched_objects") or []
        detection = matched_objects[0] if matched_objects else {
            "label": "object",
            "track_id": "n/a",
        }

        if "notification" in actions or "desktopnotification" in actions:
            self._handle_desktop_push(rule_event, detection)

        if "email" in actions:
            recipient = "khaledkherallah204@gmail.com"
            if recipient:
                self._handle_email(rule_event, detection, recipient, snapshot)
            else:
                print(f"[WARN] Rule '{rule_event.get('rule_name')}' requested email but no emailDigest configured")

    
    def execute_trigger_events(self, trigger_events, snapshot_path=None):
        """
        Execute all collected trigger events with an optional snapshot.
        Call this AFTER the annotated frame has been saved.
        
        Args:
            trigger_events: List of trigger event dicts from check_objects_in_zones
            snapshot_path: Path to the saved annotated frame snapshot
        """
        for event in trigger_events:
            self.handle_trigger(event, snapshot_path)
    
    def _handle_desktop_push(self, rule_event, detection):
        """Send a desktop push notification."""
        try:
            from plyer import notification

            rule_name = rule_event.get("rule_name", "Unnamed rule")
            message = f"Rule '{rule_name}' triggered by {detection['label']} (ID: {detection['track_id']})"
            notification.notify(
                title="EagleEye Detection Alert",
                message=message,
                timeout=5
            )
        except Exception as e:
            print(f"[ERROR] Failed to send desktop notification: {e}")  
    def _handle_email(self, rule_event, detection, email_address, snapshot):
        rule_name = rule_event.get("rule_name", "Unnamed rule")
        self.mail_service.send_email(
            recipient_email=email_address,
            subject=f"EagleEye Alert: Rule '{rule_name}' Triggered",
            body=f"Rule '{rule_name}' was triggered by {detection['label']} (ID: {detection['track_id']})",
            attachments=[snapshot] if snapshot else None
        )
        print("Success!")
        

            
    
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
        now = time.time()

        live_zone_ids = set()
        for zone in zone_manager.zones:
            zone_id = zone["id"]
            live_zone_ids.add(zone_id)
            state = self._update_zone_state_for_frame(zone, tracked_objects, zone_manager, now)
            if len(state["inside"]) > 0:
                zone_manager.set_zone_triggered(zone_id, True)

        # Remove state for deleted zones.
        for zone_id in list(self.zone_runtime_state.keys()):
            if zone_id not in live_zone_ids:
                self.zone_runtime_state.pop(zone_id, None)

        trigger_events = []
        rules = self._load_rules_config()
        for rule in rules:
            conditions = rule.get("conditions") or {}
            when_node = conditions.get("when")
            actions = conditions.get("actions") or []

            fired, matched_objects = self._evaluate_rule_node(when_node)
            if not fired:
                continue

            event = {
                "rule_id": rule.get("rule_id"),
                "rule_name": rule.get("name", "Unnamed rule"),
                "actions": actions,
                "matched_objects": matched_objects,
                "timestamp": now,
            }
            trigger_events.append(event)

        return {
            "any_triggered": len(trigger_events) > 0,
            "trigger_events": trigger_events,
        }
