import json
import cv2
import threading
import os
import queue
import time
from datetime import datetime
from detection.detector import ObjectDetector
from detection.zone_logic import ZoneManager

DATA_DIR = "data"
EVENT_LOG_PATH = os.path.join(DATA_DIR, "event_log.json")
SNAPSHOT_INDEX_PATH = os.path.join(DATA_DIR, "snapshots.json")

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
        if (rule.get("personIds") or []):
            return True
    return False


def _ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def _read_json_list(path):
    try:
        with open(path, "r") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _write_json_list(path, payload):
    _ensure_data_dir()
    with open(path, "w") as f:
        json.dump(payload, f, indent=4)


def load_persisted_event_log_history(limit=None):
    entries = _read_json_list(EVENT_LOG_PATH)
    if limit is None or limit <= 0:
        return entries
    return entries[-limit:]


def persist_event_log_history(entries):
    _write_json_list(EVENT_LOG_PATH, entries)


def clear_persisted_event_log_history():
    with EVENT_LOG_LOCK:
        EVENT_LOG_HISTORY.clear()
        persist_event_log_history(EVENT_LOG_HISTORY)


def load_snapshot_records(limit=None):
    records = _read_json_list(SNAPSHOT_INDEX_PATH)
    if limit is None or limit <= 0:
        return records
    return records[-limit:]


def persist_snapshot_records(records):
    _write_json_list(SNAPSHOT_INDEX_PATH, records)


def append_snapshot_record(record):
    with SNAPSHOT_INDEX_LOCK:
        SNAPSHOT_RECORDS.append(record)
        persist_snapshot_records(SNAPSHOT_RECORDS)


def clear_snapshot_records():
    with SNAPSHOT_INDEX_LOCK:
        SNAPSHOT_RECORDS.clear()
        persist_snapshot_records(SNAPSHOT_RECORDS)


EVENT_LOG_HISTORY = load_persisted_event_log_history()
EVENT_LOG_LOCK = threading.Lock()
SNAPSHOT_RECORDS = load_snapshot_records()
SNAPSHOT_INDEX_LOCK = threading.Lock()


def append_runtime_log(runtime, message, level="info", category="system", data=None):
    """Append a structured message to the shared runtime event log."""
    entry = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "level": level,
        "category": category,
        "message": message,
        "data": data or {},
    }
    with EVENT_LOG_LOCK:
        EVENT_LOG_HISTORY.append(entry)
        if len(EVENT_LOG_HISTORY) > 250:
            del EVENT_LOG_HISTORY[:-250]
        persist_event_log_history(EVENT_LOG_HISTORY)
    return entry


def get_event_log_history(limit=200):
    """Return a copy of the most recent event log entries."""
    with EVENT_LOG_LOCK:
        if limit is None or limit <= 0:
            return list(EVENT_LOG_HISTORY)
        return list(EVENT_LOG_HISTORY[-limit:])


def get_snapshot_history(limit=200):
    with SNAPSHOT_INDEX_LOCK:
        if limit is None or limit <= 0:
            return list(SNAPSHOT_RECORDS)
        return list(SNAPSHOT_RECORDS[-limit:])


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
        self.latest_stream_frame = None
        self.pending_annotated_frame = None
        self.pending_annotated_frame_index = 0
        self.latest_stream_frame_index = 0
        self.annotation_gate_index = 0
        self.last_trigger_events = []
        self.event_log = EVENT_LOG_HISTORY
        self.videoSource = 0  # Store trigger events until they're executed
        self.last_detection_frame_index = 0
        self.detector_busy = False
        self.state_lock = threading.Lock()
        self.detector_job_queue = queue.Queue(maxsize=1)
        self.detector_worker_stop = threading.Event()
        self.detector_worker = threading.Thread(
            target=_detector_worker_loop,
            args=(self,),
            daemon=True,
        )
        self.detector_worker.start()

        fps = float(self.cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if fps <= 0.0 or fps > 120.0:
            fps = 30.0
        self.source_fps = fps
        self.source_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        self.source_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        self.frame_interval_seconds = 1.0 / fps


def _detector_worker_loop(runtime):
    """Run detector jobs asynchronously so capture/streaming stays smooth."""
    while not runtime.detector_worker_stop.is_set():
        try:
            job = runtime.detector_job_queue.get(timeout=0.1)
        except queue.Empty:
            continue

        if job is None:
            runtime.detector_job_queue.task_done()
            break

        frame_index, frame = job
        try:
            tracked_objects = runtime.detector.track(frame)

            zone_result = runtime.detector.check_objects_in_zones(
                tracked_objects,
                runtime.zone_manager,
                frame=frame,
                frame_index=frame_index,
                source_fps=runtime.source_fps,
                face_recognizer=runtime.face_recognizer,
            )

            trigger_events = zone_result["trigger_events"]
            if trigger_events:
                highlighted_zone_ids = sorted({
                    zone_id
                    for event in trigger_events
                    for zone_id in (event.get("zone_ids") or [])
                })
                alert_frame = runtime.detector.draw_alert_snapshot(
                    frame,
                    tracked_objects,
                    runtime.zone_manager,
                    highlighted_zone_ids=highlighted_zone_ids,
                    font_scale=0.45,
                    line_width=2,
                )
                snapshot_path = save_snapshot(alert_frame, runtime.snapshot_dir)
                if snapshot_path:
                    object_summary = ", ".join(
                        f"{obj.get('label', 'object')}#{obj.get('track_id', 'n/a')}"
                        for obj in (trigger_events[0].get("matched_objects") or [])[:3]
                    ) or "object"
                    snapshot_record = {
                        "timestamp": datetime.now().isoformat(timespec="seconds"),
                        "snapshot_path": snapshot_path,
                        "source": str(runtime.videoSource),
                        "event_count": len(trigger_events),
                        "rule_ids": sorted({event.get("rule_id") for event in trigger_events if event.get("rule_id")}),
                        "rule_names": sorted({event.get("rule_name") for event in trigger_events if event.get("rule_name")}),
                        "zone_ids": sorted({
                            zone_id
                            for event in trigger_events
                            for zone_id in (event.get("zone_ids") or [])
                        }),
                        "object_summary": object_summary,
                    }
                    append_snapshot_record(snapshot_record)
                    runtime.detector.execute_trigger_events(trigger_events, snapshot_path)
                    for event in trigger_events:
                        matched_objects = event.get("matched_objects") or []
                        object_summary = ", ".join(
                            f"{obj.get('label', 'object')}#{obj.get('track_id', 'n/a')}"
                            for obj in matched_objects[:3]
                        ) or "object"
                        append_runtime_log(
                            runtime,
                            f"Rule '{event.get('rule_name', 'Unnamed rule')}' triggered by {object_summary}",
                            level="alert",
                            category="trigger",
                            data={
                                "rule_id": event.get("rule_id"),
                                "zone_ids": event.get("zone_ids") or [],
                                "snapshot_path": snapshot_path,
                            },
                        )

            with runtime.state_lock:
                runtime.tracked_objects = tracked_objects
                runtime.last_zone_triggered = zone_result["any_triggered"]
                runtime.last_trigger_events = trigger_events
                runtime.last_detection_frame_index = frame_index
        except Exception as e:
            import traceback
            print(f"[ERROR] Detector worker failed: {e}")
            traceback.print_exc()
            with runtime.state_lock:
                runtime.last_detection_frame_index = frame_index
        finally:
            with runtime.state_lock:
                runtime.detector_busy = False
            runtime.detector_job_queue.task_done()




def process_next_frame(runtime):
    """Process a single frame and return whether processing can continue."""
    ret, frame = runtime.cap.read()
    if not ret:
        return False

    runtime.frame_index += 1

    with runtime.state_lock:
        runtime.latest_stream_frame = frame.copy()
        runtime.latest_stream_frame_index = runtime.frame_index

    # Always stream raw frames; run detector only on configured cadence.
    skip = runtime.frame_skip if runtime.frame_skip >= 1 else 1
    run_track = (runtime.frame_index % skip == 0) or _zones_require_face_identity(runtime.zone_manager)
    if run_track:
        with runtime.state_lock:
            can_enqueue = not runtime.detector_busy
            if can_enqueue:
                runtime.detector_busy = True

        if can_enqueue:
            try:
                runtime.detector_job_queue.put_nowait((runtime.frame_index, frame.copy()))
                with runtime.state_lock:
                    runtime.annotation_gate_index = runtime.frame_index
            except queue.Full:
                with runtime.state_lock:
                    runtime.detector_busy = False

    # Keep compatibility for existing readers that expect latest_annotated_frame.
    with runtime.state_lock:
        runtime.latest_annotated_frame = runtime.latest_stream_frame

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
        tick_start = time.time()

        if stop_event is not None and stop_event.is_set():
            break

        if not process_next_frame(runtime):
            print("End of video or failed to grab frame")
            break

        key = cv2.waitKey(1) & 0xFF if runtime.show_window else 255
        if not handle_key_input(runtime, key):
            break

        elapsed = time.time() - tick_start
        remaining = runtime.frame_interval_seconds - elapsed
        if remaining > 0:
            time.sleep(remaining)


def close_runtime(runtime):
    """Release resources for a runtime instance."""
    runtime.detector_worker_stop.set()
    try:
        runtime.detector_job_queue.put_nowait(None)
    except queue.Full:
        pass
    if runtime.detector_worker is not None and runtime.detector_worker.is_alive():
        runtime.detector_worker.join(timeout=2)
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
        "detector_busy": runtime.detector_busy,
        "last_detection_frame_index": runtime.last_detection_frame_index,
        "show_window": runtime.show_window,
        "source_width": runtime.source_width,
        "source_height": runtime.source_height,
        "source_fps": runtime.source_fps,
    }


def run_loop_in_thread(runtime, stop_event):
    """Helper to run the loop from a thread entry point."""
    try:
        run_loop(runtime, stop_event=stop_event)
    finally:
        close_runtime(runtime)



