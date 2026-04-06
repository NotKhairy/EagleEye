import json
import cv2
import threading
import os
from datetime import datetime
from detection.detector import ObjectDetector
from detection.zone_logic import ZoneManager

# Process detection every Nth frame (1 = every frame, 2 = every other frame).

def load_global_config():
    """Load global config from file at runtime."""
    try:
        with open("config/global_config.json", "r") as f:
            config_data = json.load(f)
            return config_data[0] if isinstance(config_data, list) else config_data
    except Exception as e:
        print(f"[WARNING] Failed to load global config: {e}")
        return {"frameSkip": 5, "confidenceThreshold": 0.3, "Action": {}}


def _zones_require_face_identity(zone_manager) -> bool:
    """If true, bboxes must align with the frame used for face crop (avoid frameSkip desync)."""
    for z in zone_manager.zones:
        rule = z.get("personIdentity") or {}
        if rule.get("mode") in ("whitelist", "blacklist") and (rule.get("personIds") or []):
            return True
    return False


class EagleEyeRuntime:
    """Holds runtime state for the detection loop."""

    def __init__(
        self,
        cap
    ):
        self.detector = ObjectDetector(model_path="yolov8n.pt", confidence=0.3)
        self.zone_manager = ZoneManager(config_path="config/zone_config.json")
        self.cap = cap
        self.face_recognizer = None
        self.frame_skip = 5
        self.confidence_threshold = 0.3
        self.window_name = "EagleEye Detection"
        self.show_window = True
        self.snapshot_dir = "uploads"
        self.frame_index = 0
        self.tracked_objects = []
        self.last_zone_triggered = False
        self.latest_annotated_frame = None
        self.last_trigger_events = []
        self.videoSource = 0  # Store trigger events until they're executed




def process_next_frame(runtime):
    """Process a single frame and return whether processing can continue."""
    ret, frame = runtime.cap.read()
    if not ret:
        return False

    runtime.frame_index += 1

    # Perform detection/tracking.
    skip = runtime.frame_skip if runtime.frame_skip >= 1 else 1
    run_track = (runtime.frame_index % skip == 0) or _zones_require_face_identity(runtime.zone_manager)
    if run_track:
        runtime.tracked_objects = runtime.detector.track(frame)

    annotated_frame = runtime.detector.draw_tracks(
        frame,
        runtime.tracked_objects,
        font_scale=0.4,
        line_width=1,
    )

    # Check if matching objects are in any zones (collect triggers, don't execute yet).
    zone_result = runtime.detector.check_objects_in_zones(
        runtime.tracked_objects,
        runtime.zone_manager,
        frame=frame,
        face_recognizer=runtime.face_recognizer,
    )
    runtime.last_zone_triggered = zone_result["any_triggered"]
    runtime.last_trigger_events = zone_result["trigger_events"]

    runtime.latest_annotated_frame = annotated_frame.copy()

    # Save the annotated frame and execute triggers ONLY if there are trigger events.
    if runtime.last_trigger_events:
        snapshot_path = save_snapshot(annotated_frame, runtime.snapshot_dir)
        if snapshot_path:
            runtime.detector.execute_trigger_events(runtime.last_trigger_events, snapshot_path)

    return True


def save_snapshot(frame, snapshot_dir="uploads"):
    """
    Save the annotated frame as a snapshot with timestamp.
    
    Args:
        frame: The annotated frame to save
        snapshot_dir: Directory to save snapshots (created if doesn't exist)
    
    Returns:
        str: Path to the saved snapshot, or None if save failed
    """
    try:
        if not os.path.exists(snapshot_dir):
            os.makedirs(snapshot_dir)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]  # Include milliseconds
        filename = f"snapshot_{timestamp}.jpg"
        filepath = os.path.join(snapshot_dir, filename)
        
        cv2.imwrite(filepath, frame)
        print(f"[INFO] Snapshot saved: {filepath}")
        return filepath
    except Exception as e:
        print(f"[ERROR] Failed to save snapshot: {e}")
        return None


def handle_key_input(runtime, key):
    """Handle keyboard input and return whether loop should continue."""
    if key == ord("q"):
        return False
    if key == 27:  # Esc
        runtime.zone_manager.cancel_current_polygon()
    elif key == ord("c"):
        runtime.zone_manager.clear_all_zones()
        print("All zones cleared")
    return True


def run_loop(runtime, stop_event=None):
    """Run the frame processing loop until stop condition is met."""
    while True:
        if stop_event is not None and stop_event.is_set():
            break

        if not process_next_frame(runtime):
            print("End of video or failed to grab frame")
            break

        key = cv2.waitKey(1) & 0xFF if runtime.show_window else 255
        if not handle_key_input(runtime, key):
            break


def close_runtime(runtime):
    """Release resources for a runtime instance."""
    runtime.cap.release()
    if runtime.show_window:
        cv2.destroyAllWindows()


def get_runtime_status(runtime):
    """Return a lightweight runtime status dictionary."""
    triggered_count = sum(1 for z in runtime.zone_manager.zones if z["triggered"])
    return {
        "frame_skip": runtime.frame_skip,
        "frame_index": runtime.frame_index,
        "zone_count": len(runtime.zone_manager.zones),
        "triggered_count": triggered_count,
        "tracked_count": len(runtime.tracked_objects),
        "any_zone_triggered": runtime.last_zone_triggered,
        "show_window": runtime.show_window,
    }


def run_loop_in_thread(runtime, stop_event):
    """Helper to run the loop from a thread entry point."""
    try:
        run_loop(runtime, stop_event=stop_event)
    finally:
        close_runtime(runtime)



