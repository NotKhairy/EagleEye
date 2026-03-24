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

# Load defaults - used only if not explicitly provided
_default_config = load_global_config()
FRAME_SKIP = _default_config.get("frameSkip", 5)
CONFIDENCE_THRESHOLD = _default_config.get("confidenceThreshold", 0.3)
ACTION = _default_config.get("Action", {})

class EagleEyeRuntime:
    """Holds runtime state for the detection loop."""

    def __init__(
        self,
        detector,
        zone_manager,
        cap,
        frame_skip=FRAME_SKIP,
        confidence_threshold=CONFIDENCE_THRESHOLD,
        window_name="EagleEye Detection",
        show_window=True,
        snapshot_dir="uploads",
    ):
        self.detector = detector
        self.zone_manager = zone_manager
        self.cap = cap
        self.frame_skip = frame_skip
        self.confidence_threshold = confidence_threshold
        self.window_name = window_name
        self.show_window = show_window
        self.snapshot_dir = snapshot_dir
        self.frame_index = 0
        self.tracked_objects = []
        self.last_zone_triggered = False
        self.latest_annotated_frame = None
        self.last_trigger_events = []  # Store trigger events until they're executed


def create_runtime(
    model_path="yolov8n.pt",
    confidence=CONFIDENCE_THRESHOLD,
    zone_config_path="config/zone_config.json",
    video_source="videos/guyParkingCar.mp4",
    frame_skip=FRAME_SKIP,
    show_window=True,
    window_name="EagleEye Detection",
    snapshot_dir="uploads",
):
    """Create and initialize all components needed for processing."""
    detector = ObjectDetector(model_path=model_path, confidence=confidence)
    zone_manager = ZoneManager(config_path=zone_config_path)

    # Ensure snapshot directory exists
    if not os.path.exists(snapshot_dir):
        os.makedirs(snapshot_dir)

    resolved_video_source = video_source
    if isinstance(video_source, str) and video_source.strip() != "":
        if video_source.isdigit():
            resolved_video_source = int(video_source)
        else:
            # Try common path roots so running from backend/ or repo root both work.
            backend_dir = os.path.dirname(os.path.abspath(__file__))
            repo_root = os.path.dirname(backend_dir)
            candidate_paths = [
                video_source,
                os.path.join(repo_root, video_source),
                os.path.join(backend_dir, video_source),
                os.path.join(repo_root, "videos", os.path.basename(video_source)),
            ]
            for candidate in candidate_paths:
                if os.path.exists(candidate):
                    resolved_video_source = candidate
                    break

    cap = cv2.VideoCapture(resolved_video_source)

    if not cap.isOpened():
        print(f"Could not open video source: {resolved_video_source}")
        return None

    runtime = EagleEyeRuntime(
        detector=detector,
        zone_manager=zone_manager,
        cap=cap,
        frame_skip=frame_skip,
        window_name=window_name,
        show_window=show_window,
        snapshot_dir=snapshot_dir,
    )

    if show_window:
        cv2.namedWindow(window_name)
        cv2.setMouseCallback(window_name, zone_manager.mouse_callback)
        print(
            "EagleEye started. Left-click points to draw polygon, "
            "click first point again to close. Press Esc to cancel draft polygon."
        )

    return runtime


def process_next_frame(runtime):
    """Process a single frame and return whether processing can continue."""
    ret, frame = runtime.cap.read()
    if not ret:
        return False

    runtime.frame_index += 1

    # Perform detection/tracking.
    if runtime.frame_index % runtime.frame_skip == 0:
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
    )
    runtime.last_zone_triggered = zone_result["any_triggered"]
    runtime.last_trigger_events = zone_result["trigger_events"]

    # Draw all zones and UI.
    runtime.zone_manager.draw_zones(annotated_frame)
    draw_ui(annotated_frame, runtime.zone_manager, runtime.last_zone_triggered)
    runtime.latest_annotated_frame = annotated_frame.copy()

    # Save the annotated frame and execute triggers ONLY if there are trigger events.
    if runtime.last_trigger_events:
        snapshot_path = save_snapshot(annotated_frame, runtime.snapshot_dir)
        if snapshot_path:
            runtime.detector.execute_trigger_events(runtime.last_trigger_events, snapshot_path)

    if runtime.show_window:
        cv2.imshow(runtime.window_name, annotated_frame)

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


def main():
    """Main application loop"""
    runtime = create_runtime(show_window=True)
    if runtime is None:
        return

    stop_event = threading.Event()
    try:
        run_loop(runtime, stop_event=stop_event)
    finally:
        close_runtime(runtime)


def draw_ui(frame, zone_manager, any_zone_triggered):
    # """Draw UI elements on frame"""
    # # Instructions
    # instructions = "Left-click: Add point/close polygon | Esc: Cancel draft | Right-click: Delete | 'c': Clear all | 'q': Quit"
    # cv2.putText(frame, instructions, (10, 30), 
    #             cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    
    # Status information
    zone_count = len(zone_manager.zones)
    triggered_count = sum(1 for z in zone_manager.zones if z["triggered"])
    status = f"Zones: {zone_count} | Triggered: {triggered_count}"
    cv2.putText(frame, status, (10, 60), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)


if __name__ == "__main__":
    main()