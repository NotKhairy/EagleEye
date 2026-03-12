import cv2
from deep_sort_realtime.deepsort_tracker import DeepSort
from ultralytics import YOLO
import time

class ObjectDetector:
    """Handles YOLO detection + DeepSORT tracking and object-zone matching."""
    
    def __init__(self, model_path="yolov8n.pt", confidence=0.5, trigger_cooldown_seconds=5):
        self.model = YOLO(model_path)
        self.confidence = confidence
        self.tracker = DeepSort(max_age=30, n_init=3)
        self.trigger_cooldown_seconds = trigger_cooldown_seconds
        # key: (zone_id, track_id), value: last trigger timestamp
        self.last_trigger_times = {}
    
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
                    
                    break
        
        return len(triggered_zones) > 0
