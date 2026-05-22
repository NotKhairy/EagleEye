from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi import Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Union, Literal
import asyncio
import json
import os
import subprocess
import threading
import time
import mimetypes
import cv2
import shutil
from uuid import uuid4
from main import (
    EagleEyeRuntime,
    append_runtime_log,
    close_runtime,
    get_event_log_history,
    get_snapshot_history,
    get_runtime_status,
    clear_persisted_event_log_history,
    clear_snapshot_records,
    run_loop_in_thread,
)

app = FastAPI()

DEFAULT_GLOBAL_CONFIG = "config/global_config.json"
DEFAULT_VIDEO_SOURCE_CONFIG = "config/video_source.json"

runtime = None
worker_thread = None
stop_event = threading.Event()
runtime_lock = threading.Lock()

UPLOADS_DIR = "uploads"
NORMALIZED_VIDEO_SIZE = (1280, 720)
NORMALIZED_VIDEO_FPS = 30.0
SUPPORTED_VIDEO_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".m4v",
    ".mkv",
    ".webm",
    ".avi",
}


CONFIG_FILES = {
    "global": "config/global_config.json",
    "zones": "config/zone_config.json",
    "rules": "config/rules_config.json",
    "video_source": DEFAULT_VIDEO_SOURCE_CONFIG,
}

# Face recognition globals (lazy init)
_known_people_store = None
_face_recognizer = None
_face_lock = threading.Lock()

class RulePayload(BaseModel):
    rule_id: str
    name: str
    description: Optional[str] = None
    conditions: dict  # This can be further defined based on expected rule structure
    severity: str = "info"


def _get_face_components():
    global _known_people_store, _face_recognizer
    with _face_lock:
        if _known_people_store is None:
            from face.storage import KnownPeopleStore

            _known_people_store = KnownPeopleStore(root_dir="known_people")
        if _face_recognizer is None:
            from face.recognizer import FaceRecognizer

            # Cosine distance = 1 - cosine_similarity; ~0.55 is lenient enough for webcam enroll vs live.
            _face_recognizer = FaceRecognizer(_known_people_store, threshold=0.55, min_face_size=40)
        return _known_people_store, _face_recognizer


def _attach_face_to_runtime(rt):
    try:
        _, recognizer = _get_face_components()
        rt.face_recognizer = recognizer
    except Exception as e:
        # Keep core detection functional even if face deps aren't installed.
        print(f"[face] Warning: face recognizer unavailable: {e}")
        rt.face_recognizer = None


def _shutdown_runtime(reason: str = "shutdown"):
    global runtime, worker_thread, stop_event

    with runtime_lock:
        current_runtime = runtime
        current_worker = worker_thread
        current_stop_event = stop_event

    print(f"[{reason}] Cleanup requested")
    if current_stop_event is not None:
        current_stop_event.set()

    if current_worker is not None and current_worker.is_alive():
        print(f"[{reason}] Waiting for worker thread to stop...")
        current_worker.join(timeout=5)

    if current_runtime is not None:
        print(f"[{reason}] Releasing runtime resources...")
        close_runtime(current_runtime)

    if current_worker is not None and current_worker.is_alive():
        print(f"[{reason}] Worker thread is still alive after cleanup timeout")
    else:
        print(f"[{reason}] Worker thread stopped cleanly")

    with runtime_lock:
        if worker_thread is current_worker and (current_worker is None or not current_worker.is_alive()):
            worker_thread = None
        if runtime is current_runtime:
            runtime = None

    print(f"[{reason}] Cleanup complete")


def _monitoring_is_active() -> bool:
    with runtime_lock:
        return worker_thread is not None and worker_thread.is_alive()


def _read_json_file(path: str):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _config_is_ready(path: str) -> bool:
    data = _read_json_file(path)
    if data is None:
        return False
    if isinstance(data, list):
        return len(data) > 0
    if isinstance(data, dict):
        return len(data) > 0
    return True


def _boot_ready_state():
    missing = [name for name, path in CONFIG_FILES.items() if not _config_is_ready(path)]
    return {
        "ready": len(missing) == 0,
        "missing_or_empty": missing,
    }


def _require_monitoring_paused():
    if _monitoring_is_active():
        raise HTTPException(status_code=409, detail="Stop monitoring before editing configuration")


def _clear_directory(path: str):
    if not os.path.exists(path):
        return
    for entry in os.listdir(path):
        entry_path = os.path.join(path, entry)
        if os.path.isdir(entry_path):
            shutil.rmtree(entry_path)
        else:
            os.remove(entry_path)


def _write_json_list(path: str, payload: list):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(payload, f, indent=4)


def _write_json_value(path: str, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(payload, f, indent=4)


def _sanitize_upload_stem(filename: str) -> str:
    base_name = os.path.basename(filename or "").strip()
    stem, _ = os.path.splitext(base_name)
    safe_stem = "".join(character if character.isalnum() or character in ("-", "_") else "_" for character in stem)
    safe_stem = safe_stem.strip("._")
    return safe_stem or "video"


async def _save_upload_to_path(file: UploadFile, destination_path: str) -> None:
    os.makedirs(os.path.dirname(destination_path), exist_ok=True)
    with open(destination_path, "wb") as destination_file:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            destination_file.write(chunk)


def _normalize_video_with_ffmpeg(input_path: str, output_path: str) -> bool:
    ffmpeg_executable = shutil.which("ffmpeg")
    if not ffmpeg_executable:
        return False

    command = [
        ffmpeg_executable,
        "-y",
        "-i",
        input_path,
        "-vf",
        f"scale={NORMALIZED_VIDEO_SIZE[0]}:{NORMALIZED_VIDEO_SIZE[1]},fps={int(NORMALIZED_VIDEO_FPS)}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-an",
        output_path,
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[upload_video] ffmpeg normalization failed: {result.stderr.strip() or result.stdout.strip()}")
        return False

    return True


def _normalize_video_with_opencv(input_path: str, output_path: str) -> None:
    capture = cv2.VideoCapture(input_path)
    if not capture.isOpened():
        capture.release()
        raise HTTPException(status_code=400, detail="Uploaded file could not be opened as a video")

    source_fps = capture.get(cv2.CAP_PROP_FPS)
    if not source_fps or source_fps <= 0:
        source_fps = NORMALIZED_VIDEO_FPS

    output_fps = min(source_fps, NORMALIZED_VIDEO_FPS)
    writer = cv2.VideoWriter(
        output_path,
        cv2.VideoWriter_fourcc(*"mp4v"),
        output_fps,
        NORMALIZED_VIDEO_SIZE,
    )
    if not writer.isOpened():
        capture.release()
        writer.release()
        raise HTTPException(status_code=500, detail="Unable to create normalized video output")

    frame_interval = 1.0 / source_fps
    next_output_time = 0.0
    elapsed_time = 0.0

    try:
        while True:
            success, frame = capture.read()
            if not success:
                break

            if source_fps > NORMALIZED_VIDEO_FPS and elapsed_time + 1e-9 < next_output_time:
                elapsed_time += frame_interval
                continue

            resized_frame = cv2.resize(frame, NORMALIZED_VIDEO_SIZE, interpolation=cv2.INTER_AREA)
            writer.write(resized_frame)

            if source_fps > NORMALIZED_VIDEO_FPS:
                next_output_time += 1.0 / NORMALIZED_VIDEO_FPS

            elapsed_time += frame_interval
    finally:
        capture.release()
        writer.release()

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise HTTPException(status_code=500, detail="Video normalization did not produce an output file")


def _normalize_uploaded_video(input_path: str, output_path: str) -> None:
    if _normalize_video_with_ffmpeg(input_path, output_path):
        return

    _normalize_video_with_opencv(input_path, output_path)


def _probe_video_metadata(video_source: str):
    capture_source: Union[str, int] = 0 if video_source == "0" else video_source
    capture = cv2.VideoCapture(capture_source)
    if not capture.isOpened():
        capture.release()
        raise HTTPException(status_code=400, detail=f"Could not open video source: {video_source}")

    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    capture.release()

    return {
        "source_width": width if width > 0 else None,
        "source_height": height if height > 0 else None,
        "source_fps": fps if fps > 0 else None,
    }

@app.get("/")
def root():
    return {"message": "EagleEye backend running"}


@app.get("/boot_status")
def boot_status():
    return _boot_ready_state()


@app.get("/monitoring_status")
def monitoring_status():
    with runtime_lock:
        if worker_thread is not None and worker_thread.is_alive() and runtime is not None:
            return {"state": "running", "active": True, "runtime": get_runtime_status(runtime)}
        return {"state": "paused", "active": False, "runtime": None}


@app.get("/video_source_metadata")
def video_source_metadata(video_source: str):
    return _probe_video_metadata(video_source)


@app.post("/upload_video")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file and return the path for use with start_monitoring."""
    try:
        os.makedirs(UPLOADS_DIR, exist_ok=True)

        filename = file.filename or "uploaded_video.mp4"
        file_extension = os.path.splitext(filename)[1].lower()
        content_type = (file.content_type or "").lower()
        if content_type and not content_type.startswith("video/") and file_extension not in SUPPORTED_VIDEO_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Only video uploads are supported")

        upload_id = uuid4().hex[:8]
        safe_stem = _sanitize_upload_stem(filename)
        raw_extension = file_extension if file_extension else ".bin"
        raw_upload_path = os.path.join(UPLOADS_DIR, f"{safe_stem}_{upload_id}_source{raw_extension}")
        normalized_upload_path = os.path.join(UPLOADS_DIR, f"{safe_stem}_{upload_id}_720p30.mp4")

        await _save_upload_to_path(file, raw_upload_path)

        try:
            _normalize_uploaded_video(raw_upload_path, normalized_upload_path)
        except Exception:
            if os.path.exists(normalized_upload_path):
                os.remove(normalized_upload_path)
            raise
        finally:
            if os.path.exists(raw_upload_path):
                os.remove(raw_upload_path)

        print(f"[upload_video] File uploaded and normalized: {normalized_upload_path}")
        return {"status": "success", "file_path": normalized_upload_path}
    except Exception as e:
        print(f"[upload_video] Error uploading file: {e}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/video_feed")
async def video_feed(request: Request):
    target_fps = 15
    frame_interval = 1.0 / target_fps
    frames_sent = 0
    
    print("[video_feed] Stream connected, waiting for frames...")

    async def generate():
        nonlocal frames_sent
        startup_delay = 0  # Track time waiting for first frame
        while True:
            if await request.is_disconnected():
                print("[video_feed] Client disconnected")
                break

            frame = None
            with runtime_lock:
                if runtime is None:
                    break
                if runtime is not None:
                    with runtime.state_lock:
                        if runtime.latest_stream_frame is not None:
                            frame = runtime.latest_stream_frame.copy()

            if frame is None:
                startup_delay += 0.05
                if startup_delay > 5:  # Log every 5 seconds if no frames
                    print(f"[video_feed] Still waiting for frames... (elapsed: {startup_delay}s)")
                    startup_delay = 0
                await asyncio.sleep(0.05)
                continue

            ok, buffer = cv2.imencode(".jpg", frame)
            if not ok:
                await asyncio.sleep(0.01)
                continue

            jpg = buffer.tobytes()
            frames_sent += 1
            if frames_sent == 1:
                print(f"[video_feed] ✓ First frame sent! Frame size: {len(jpg)} bytes")
            
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
            )
            await asyncio.sleep(frame_interval)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.on_event("shutdown")
def on_shutdown():
    _shutdown_runtime("shutdown")


@app.get("/event_log")
def event_log(limit: int = 200):
    return get_event_log_history(limit)


class GlobalConfigPayload(BaseModel):
    frameSkip: int
    confidenceThreshold: float
    recipientEmail: Optional[str] = None



@app.post("/global_config")
def global_config(payload: GlobalConfigPayload):
    _require_monitoring_paused()
    os.makedirs(os.path.dirname(DEFAULT_GLOBAL_CONFIG), exist_ok=True)
    with open(DEFAULT_GLOBAL_CONFIG, "w") as f:
        json.dump([payload.model_dump()], f, indent=4)

    return {"status": "saved", "path": DEFAULT_GLOBAL_CONFIG}


@app.get("/global_config")
def get_global_config():
    data = _read_json_file(DEFAULT_GLOBAL_CONFIG)
    if isinstance(data, list) and data:
        return data[0]
    if isinstance(data, dict):
        return data
    return {"frameSkip": 5, "confidenceThreshold": 0.3, "recipientEmail": ""}


@app.get("/rules")
def get_rules():
    data = _read_json_file("config/rules_config.json")
    return data if isinstance(data, list) else []


@app.get("/video_source_config")
def get_video_source_config():
    data = _read_json_file(DEFAULT_VIDEO_SOURCE_CONFIG)
    return data if isinstance(data, dict) else {"video_source": None}


@app.post("/video_source_config")
def set_video_source_config(payload: dict):
    _require_monitoring_paused()
    video_source = payload.get("video_source")
    _write_json_value(DEFAULT_VIDEO_SOURCE_CONFIG, {"video_source": video_source})
    return {"status": "saved", "video_source": video_source}

@app.post("/zone_config")
def zone_config():
    global runtime
    with runtime_lock:
        if runtime is None:
            return {"status": "not initialized"}
        runtime.zone_manager.load_zones()
        return {"status": "zones loaded", "zone_count": len(runtime.zone_manager.zones)}


@app.post("/initialize")
def initialize(
    model_path: str = "yolov8n.pt",
    confidence: float = 0.3,
    zone_config_path: str = "config/zone_config.json",
    video_source: str = "videos/guyParkingCar.mp4",
    frame_skip: int = 2,
    show_window: bool = False,
):
    global runtime, worker_thread, stop_event
    with runtime_lock:
        if worker_thread is not None and worker_thread.is_alive():
            return {"status": "already running", "message": "Stop the loop before re-initializing"}

        if runtime is not None:
            close_runtime(runtime)
            runtime = None

        stop_event = threading.Event()
        runtime = EagleEyeRuntime(cap=cv2.VideoCapture(video_source))
        _attach_face_to_runtime(runtime)
        append_runtime_log(runtime, f"Monitoring initialized from {video_source}", category="system")

        return {"status": "initialized", "runtime": get_runtime_status(runtime)}

@app.post("/start")
def start():
    global runtime, worker_thread, stop_event
    with runtime_lock:
        if worker_thread is not None and worker_thread.is_alive():
            return {"status": "already running"}

        if runtime is None:
            runtime = EagleEyeRuntime(cap=cv2.VideoCapture(0))
            _attach_face_to_runtime(runtime)
            runtime.show_window = False
            if runtime is None:
                runtime = EagleEyeRuntime(cap=cv2.VideoCapture(0))
                _attach_face_to_runtime(runtime)
                runtime.show_window = False
                runtime.video_source = 0
            if runtime is None:
                return {"status": "error", "message": "Could not initialize video source (file and webcam fallback failed)"}

        stop_event.clear()
        append_runtime_log(runtime, "Monitoring started from webcam", category="system")
        worker_thread = threading.Thread(
            target=run_loop_in_thread,
            args=(runtime, stop_event),
            daemon=True,
        )
        worker_thread.start()
        return {"status": "started"}


class StartMonitoringPayload(BaseModel):
    video_source: str


@app.post("/start_monitoring")
def start_monitoring(payload: StartMonitoringPayload):
    """Initialize runtime with video source and start processing immediately."""
    global runtime, worker_thread, stop_event
    with runtime_lock:
        # Stop any existing processing
        if worker_thread is not None and worker_thread.is_alive():
            print("[start_monitoring] Stopping existing worker thread...")
            stop_event.set()
            worker_thread.join(timeout=2)
            worker_thread = None
        
        if runtime is not None:
            print("[start_monitoring] Closing existing runtime...")
            close_runtime(runtime)
            runtime = None
        
        # Read the global config to get frame skip and confidence threshold
        try:
            with open(DEFAULT_GLOBAL_CONFIG, "r") as f:
                global_config_data = json.load(f)
                if isinstance(global_config_data, list) and len(global_config_data) > 0:
                    config = global_config_data[0]
                    frame_skip = config.get("frameSkip", 5)
                    confidence = config.get("confidenceThreshold", 0.3)
                else:
                    frame_skip = 5
                    confidence = 0.3
        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"[start_monitoring] Warning: Could not read global config: {e}")
            frame_skip = 5
            confidence = 0.3
        
        # Initialize runtime with the provided video source
        print(f"[start_monitoring] Initializing runtime with video_source: {payload.video_source}")
        stop_event = threading.Event()
        if payload.video_source == "0":
            payload.video_source = 0

        capture = cv2.VideoCapture(payload.video_source)
        if not capture.isOpened():
            capture.release()
            raise HTTPException(status_code=400, detail=f"Could not open video source: {payload.video_source}")

        runtime = EagleEyeRuntime(cap=capture)
        runtime.videoSource = payload.video_source
        _attach_face_to_runtime(runtime)
        runtime.frame_skip = frame_skip
        runtime.confidence_threshold = confidence
        runtime.detector.confidence = confidence
        
        if runtime is None:
            error_msg = f"Could not initialize video source: {payload.video_source}"
            print(f"[start_monitoring] ERROR: {error_msg}")
            return {"status": "error", "message": error_msg}

        _write_json_value(DEFAULT_VIDEO_SOURCE_CONFIG, {"video_source": payload.video_source})

        append_runtime_log(runtime, f"Monitoring started from {payload.video_source}", category="system")
        
        # Start the processing loop in a background thread
        print("[start_monitoring] Starting processing loop thread...")
        worker_thread = threading.Thread(
            target=run_loop_in_thread,
            args=(runtime, stop_event),
            daemon=True,
        )
        worker_thread.start()
        
        status = get_runtime_status(runtime)
        print(f"[start_monitoring] SUCCESS: Runtime started with status: {status}")
        return {"status": "started", "video_source": payload.video_source, "runtime": status}


@app.get("/video_source_info")
def video_source_info():
    with runtime_lock:
        if runtime is None:
            return {
                "status": "not_running",
                "source_type": "unknown",
                "direct_video_url": None,
                "source_width": None,
                "source_height": None,
                "source_fps": None,
            }

        source = runtime.videoSource
        if source == 0 or source == "0":
            return {
                "status": "running",
                "source_type": "camera",
                "direct_video_url": None,
                "source_width": runtime.source_width,
                "source_height": runtime.source_height,
                "source_fps": runtime.source_fps,
            }

        return {
            "status": "running",
            "source_type": "video_file",
            "direct_video_url": "/api/video_file",
            "source_width": runtime.source_width,
            "source_height": runtime.source_height,
            "source_fps": runtime.source_fps,
        }


@app.get("/video_file")
def video_file():
    with runtime_lock:
        if runtime is None:
            raise HTTPException(status_code=404, detail="Monitoring runtime is not active")
        source = runtime.videoSource

    if source == 0 or source == "0" or source is None:
        raise HTTPException(status_code=400, detail="Current monitoring source is not a video file")

    source_path = str(source)
    if not os.path.exists(source_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {source_path}")

    media_type = mimetypes.guess_type(source_path)[0] or "application/octet-stream"
    return FileResponse(path=source_path, media_type=media_type, filename=os.path.basename(source_path))


@app.get("/uploads/{filename}")
def uploaded_media(filename: str):
        media_path = os.path.join("uploads", os.path.basename(filename))
        if not os.path.exists(media_path):
            raise HTTPException(status_code=404, detail=f"Media file not found: {filename}")

        media_type = mimetypes.guess_type(media_path)[0] or "application/octet-stream"
        return FileResponse(path=media_path, media_type=media_type, filename=os.path.basename(media_path))


@app.post("/stop")
def stop():
    global runtime, worker_thread, stop_event
    with runtime_lock:
        if worker_thread is None or not worker_thread.is_alive():
            if runtime is not None:
                append_runtime_log(runtime, "Monitoring stopped", category="system")
                close_runtime(runtime)
                runtime = None
            return {"status": "not running"}

    if runtime is not None:
        append_runtime_log(runtime, "Monitoring stopped", category="system")
    _shutdown_runtime("stop")
    return {"status": "stopped"}


@app.get("/snapshots")
def snapshots(limit: int = 200):
    return get_snapshot_history(limit)


@app.post("/clear_logs")
def clear_logs():
    _require_monitoring_paused()
    clear_persisted_event_log_history()
    return {"status": "logs cleared"}


@app.post("/clear_snapshots")
def clear_snapshots():
    _require_monitoring_paused()
    clear_snapshot_records()
    _clear_directory("uploads")
    return {"status": "snapshots cleared"}


@app.post("/factory_reset")
def factory_reset():
    _shutdown_runtime("factory_reset")
    _write_json_list(DEFAULT_GLOBAL_CONFIG, [])
    _write_json_list("config/zone_config.json", [])
    _write_json_list("config/rules_config.json", [])
    _write_json_value(DEFAULT_VIDEO_SOURCE_CONFIG, {"video_source": None})
    clear_persisted_event_log_history()
    clear_snapshot_records()
    _clear_directory("uploads")
    _clear_directory("known_people")
    os.makedirs("uploads", exist_ok=True)
    os.makedirs("known_people", exist_ok=True)
    return {"status": "factory reset complete"}


@app.post("/clear_config")
def clear_config():
    _require_monitoring_paused()
    _write_json_list(DEFAULT_GLOBAL_CONFIG, [])
    _write_json_list("config/zone_config.json", [])
    _write_json_list("config/rules_config.json", [])
    _write_json_value(DEFAULT_VIDEO_SOURCE_CONFIG, {"video_source": None})
    return {"status": "configuration cleared"}


@app.post("/clear_zones")
def clear_zones():
    global runtime
    _require_monitoring_paused()
    config_path = _zone_config_path()
    
    # Clear zones from JSON file
    try:
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, "w") as f:
            json.dump([], f, indent=4)
        print("[clear_zones] Cleared zone_config.json file")
    except Exception as e:
        print(f"[clear_zones] Error clearing zone config file: {e}")
    
    # Clear zones from runtime if it exists
    with runtime_lock:
        if runtime is None:
            return {"status": "zones cleared (no runtime)"}
        runtime.zone_manager.clear_all_zones()
        return {"status": "zones cleared from runtime and file"}


@app.get("/zones")
def get_zones():
    config_path = _zone_config_path()
    try:
        with open(config_path, "r") as f:
            zones = json.load(f)
            if isinstance(zones, list):
                return zones
            return []
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []


@app.post("/clear_rules")
def clear_rules():
    global runtime
    _require_monitoring_paused()
    rules_path = "config/rules_config.json"
    
    # Clear rules from JSON file
    try:
        os.makedirs(os.path.dirname(rules_path), exist_ok=True)
        with open(rules_path, "w") as f:
            json.dump([], f, indent=4)
        print("[clear_rules] Cleared rules_config.json file")
    except Exception as e:
        print(f"[clear_rules] Error clearing rules config file: {e}")
    
    # Clear rules from runtime if it exists
    with runtime_lock:
        if runtime is None:
            return {"status": "rules cleared (no runtime)"}
        runtime.rule_manager.clear_all_rules()
        return {"status": "rules cleared from runtime and file"}
    
@app.post("/save_rules")
def save_rules(rules: List[RulePayload]):
    _require_monitoring_paused()
    rules_path = "config/rules_config.json"
    
    # Save rules to JSON file
    try:
        serializable_rules = [rule.model_dump() for rule in rules]
        os.makedirs(os.path.dirname(rules_path), exist_ok=True)
        with open(rules_path, "w") as f:
            json.dump(serializable_rules, f, indent=4)
        print(f"[save_rules] Saved {len(rules)} rules to rules_config.json")
    except Exception as e:
        print(f"[save_rules] Error saving rules config file: {e}")
        return {"status": "error", "message": str(e)}
    
    # Reload rules into runtime if it exists
    with runtime_lock:
        if runtime is not None:
            runtime.rule_manager.load_rules()
            print("[save_rules] Rules reloaded into runtime")
    
    return {"status": "rules saved and reloaded into runtime if available", "rule_count": len(rules)}

# ---------- Zone management ----------

class PersonIdentityPayload(BaseModel):
    personIds: List[str]


class ZonePayload(BaseModel):
    zone_id: str
    zone_name: str
    description: str = "Detection zone"
    # COCO class name(s): string (legacy) or list for multiple trigger objects
    trigger: Union[str, List[str]] = "person"
    coordinates: List[List[float]]
    rule: str = "loitering"
    severity: str = "info"
    dwellTime: Optional[float] = None
    personIdentity: Optional[PersonIdentityPayload] = None





DEFAULT_ZONE_CONFIG = "config/zone_config.json"


def _zone_config_path() -> str:
    global runtime
    if runtime is not None:
        return runtime.zone_manager.config_path
    return DEFAULT_ZONE_CONFIG


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


@app.post("/zones")
def add_zone(payload: ZonePayload):
    global runtime
    _require_monitoring_paused()
    config_path = _zone_config_path()

    # Load existing zones from JSON
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            try:
                zones = json.load(f)
            except json.JSONDecodeError:
                zones = []
    else:
        zones = []

    # Remove any zone with the same id (upsert)
    zones = [z for z in zones if str(z.get("zone_id", "")) != str(payload.zone_id)]

    zones.append({
        "zone_name": payload.zone_name,
        "zone_id": payload.zone_id,
        "description": payload.description,
        "trigger": payload.trigger,
        "coordinates": payload.coordinates,
        "rule": payload.rule,
        "severity": payload.severity,
        "dwellTime": payload.dwellTime if payload.dwellTime is not None else 10,
        "personIdentity": payload.personIdentity.model_dump() if payload.personIdentity else None,
    })

    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    with open(config_path, "w") as f:
        json.dump(zones, f, indent=4)

    # Hot-reload into running runtime if available
    with runtime_lock:
        if runtime is not None:
            runtime.zone_manager.load_zones()

    return {"status": "saved", "zone_id": payload.zone_id}


# ---------- Known people / enrollment ----------

class PersonCreatePayload(BaseModel):
    name: str


class PersonResponse(BaseModel):
    id: str
    name: str


@app.get("/people", response_model=List[PersonResponse])
def list_people():
    store, _ = _get_face_components()
    return [PersonResponse(id=p.id, name=p.name) for p in store.list_people()]


@app.post("/people", response_model=PersonResponse)
def create_person(payload: PersonCreatePayload):
    store, _ = _get_face_components()
    person = store.create_person(payload.name)
    return PersonResponse(id=person.id, name=person.name)


@app.delete("/people/{person_id}")
def delete_person(person_id: str):
    store, recognizer = _get_face_components()
    ok = store.delete_person(person_id)
    recognizer.reload_known()
    if not ok:
        raise HTTPException(status_code=404, detail="Person not found")
    return {"status": "deleted", "person_id": person_id}


@app.post("/people/{person_id}/images")
async def upload_person_images(person_id: str, files: List[UploadFile] = File(...)):
    """
    Upload one or more reference images for a person and enroll them into embeddings.
    """
    store, recognizer = _get_face_components()
    if store.get_person(person_id) is None:
        raise HTTPException(status_code=404, detail="Person not found")

    images_dir = store.images_dir(person_id)
    os.makedirs(images_dir, exist_ok=True)

    saved_paths: List[str] = []
    for f in files:
        ext = os.path.splitext(f.filename or "")[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp"):
            ext = ".jpg"
        out_name = f"{uuid4().hex}{ext}"
        out_path = os.path.join(images_dir, out_name)
        with open(out_path, "wb") as out:
            shutil.copyfileobj(f.file, out)
        saved_paths.append(out_path)

    from face.enroll import enroll_images_for_person

    processed, added = enroll_images_for_person(
        person_id=person_id,
        image_paths=saved_paths,
        known_store=store,
        face_recognizer=recognizer,
    )
    return {"status": "enrolled", "processed_images": processed, "embeddings_added": added}


@app.delete("/zones/{zone_id}")
def remove_zone(zone_id: str):
    config_path = _zone_config_path()

    if not os.path.exists(config_path):
        return {"status": "not_found"}

    with open(config_path, "r") as f:
        try:
            zones = json.load(f)
        except json.JSONDecodeError:
            zones = []

    updated = [z for z in zones if str(z.get("zone_id", "")) != zone_id]

    with open(config_path, "w") as f:
        json.dump(updated, f, indent=4)

    with runtime_lock:
        if runtime is not None:
            runtime.zone_manager.load_zones()

    return {"status": "deleted", "zone_id": zone_id}
