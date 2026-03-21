from flask import json

import cv2
import threading
import time
import os
from detection.detector import ObjectDetector
from detection.zone_logic import ZoneManager

# Process detection every Nth frame (1 = every frame, 2 = every other frame).

with open("config/global_config.json", "r") as f:
    global_config = json.load(f)[0]
    FRAME_SKIP = global_config.get("frameSkip", 5)
    CONFIDENCE_THRESHOLD = global_config.get("confidenceThreshold", 0.3)
    ACTION = global_config.get("Action", {})

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
    ):
        self.detector = detector
        self.zone_manager = zone_manager
        self.cap = cap
        self.frame_skip = frame_skip
        self.confidence_threshold = confidence_threshold
        self.window_name = window_name
        self.show_window = show_window
        self.frame_index = 0
        self.tracked_objects = []
        self.last_zone_triggered = False
        self.latest_annotated_frame = None


def create_runtime(
    model_path="yolov8n.pt",
    confidence=CONFIDENCE_THRESHOLD,
    zone_config_path="config/zone_config.json",
    video_source="videos/guyParkingCar.mp4",
    frame_skip=FRAME_SKIP,
    show_window=True,
    window_name="EagleEye Detection",
):
    """Create and initialize all components needed for processing."""
    detector = ObjectDetector(model_path=model_path, confidence=confidence)
    zone_manager = ZoneManager(config_path=zone_config_path)

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

    # Give camera time to initialize (especially important for USB cameras)
    if isinstance(resolved_video_source, int):
        print(f"Initializing camera {resolved_video_source}... configuring and waiting 2 seconds")
        
        # Set camera properties to optimize streaming
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Minimize buffer to get fresh frames
        cap.set(cv2.CAP_PROP_FPS, 30)  # Set target FPS
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)  # Set resolution
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        
        time.sleep(2)  # Extended wait for camera to be ready

    runtime = EagleEyeRuntime(
        detector=detector,
        zone_manager=zone_manager,
        cap=cap,
        frame_skip=frame_skip,
        window_name=window_name,
        show_window=show_window,
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

    # Check if matching objects are in any zones.
    runtime.last_zone_triggered = runtime.detector.check_objects_in_zones(
        runtime.tracked_objects,
        runtime.zone_manager,
    )

    # Draw all zones and UI.
    runtime.zone_manager.draw_zones(annotated_frame)
    draw_ui(annotated_frame, runtime.zone_manager, runtime.last_zone_triggered)
    runtime.latest_annotated_frame = annotated_frame.copy()

    if runtime.show_window:
        cv2.imshow(runtime.window_name, annotated_frame)

    return True


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
    # Warmup: discard first 10 frames to ensure camera is ready
    print("Warming up camera... discarding first 10 frames with 200ms delays")
    frame_count = 0
    for i in range(10):
        ret, frame = runtime.cap.read()
        if ret:
            frame_count += 1
            print(f"  Warmup frame {i+1}/10 OK")
        else:
            print(f"  Warmup frame {i+1}/10 FAILED - waiting longer...")
        time.sleep(0.2)  # 200ms between warmup frames
    
    if frame_count == 0:
        print("ERROR: Camera did not produce any frames during warmup!")
        print("This may indicate the camera is in use by another application or has a driver issue.")
    else:
        print(f"Camera warmup complete ({frame_count} frames captured), starting main loop")
    
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
    """Draw UI elements on frame"""
    # Instructions
    instructions = "Left-click: Add point/close polygon | Esc: Cancel draft | Right-click: Delete | 'c': Clear all | 'q': Quit"
    cv2.putText(frame, instructions, (10, 30), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    
    # Status information
    zone_count = len(zone_manager.zones)
    triggered_count = sum(1 for z in zone_manager.zones if z["triggered"])
    status = f"Zones: {zone_count} | Triggered: {triggered_count}"
    cv2.putText(frame, status, (10, 60), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)


if __name__ == "__main__":
    main()