from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Union, Literal
import json
import os
import threading
import time
import cv2
import shutil
from uuid import uuid4
from main import (
    EagleEyeRuntime,
    append_runtime_log,
    close_runtime,
    get_event_log_history,
    get_runtime_status,
    run_loop_in_thread,
)

app = FastAPI()

DEFAULT_GLOBAL_CONFIG = "config/global_config.json"

runtime = None
worker_thread = None
stop_event = threading.Event()
runtime_lock = threading.Lock()

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

@app.get("/")
def root():
    return {"message": "EagleEye backend running"}


@app.post("/upload_video")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file and return the path for use with start_monitoring."""
    try:
        # Create uploads directory if it doesn't exist
        upload_dir = "uploads"
        os.makedirs(upload_dir, exist_ok=True)
        
        # Save the uploaded file
        file_path = os.path.join(upload_dir, file.filename)
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        print(f"[upload_video] File uploaded: {file_path}")
        return {"status": "success", "file_path": file_path}
    except Exception as e:
        print(f"[upload_video] Error uploading file: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/video_feed")
def video_feed():
    target_fps = 15
    frame_interval = 1.0 / target_fps
    frames_sent = 0
    
    print("[video_feed] Stream connected, waiting for frames...")

    def generate():
        nonlocal frames_sent
        startup_delay = 0  # Track time waiting for first frame
        while True:
            frame = None
            with runtime_lock:
                if runtime is not None:
                    with runtime.state_lock:
                        if runtime.latest_stream_frame is not None:
                            frame = runtime.latest_stream_frame.copy()

            if frame is None:
                startup_delay += 0.05
                if startup_delay > 5:  # Log every 5 seconds if no frames
                    print(f"[video_feed] Still waiting for frames... (elapsed: {startup_delay}s)")
                    startup_delay = 0
                time.sleep(0.05)
                continue

            ok, buffer = cv2.imencode(".jpg", frame)
            if not ok:
                time.sleep(0.01)
                continue

            jpg = buffer.tobytes()
            frames_sent += 1
            if frames_sent == 1:
                print(f"[video_feed] ✓ First frame sent! Frame size: {len(jpg)} bytes")
            
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
            )
            time.sleep(frame_interval)

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/event_log")
def event_log(limit: int = 200):
    return get_event_log_history(limit)


class GlobalConfigPayload(BaseModel):
    frameSkip: int
    confidenceThreshold: float



@app.post("/global_config")
def global_config(payload: GlobalConfigPayload):
    os.makedirs(os.path.dirname(DEFAULT_GLOBAL_CONFIG), exist_ok=True)
    with open(DEFAULT_GLOBAL_CONFIG, "w") as f:
        json.dump([payload.model_dump()], f, indent=4)

    return {"status": "saved", "path": DEFAULT_GLOBAL_CONFIG}

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
        runtime = EagleEyeRuntime(cap=cv2.VideoCapture(payload.video_source))
        _attach_face_to_runtime(runtime)
        runtime.frame_skip = frame_skip
        runtime.confidence_threshold = confidence
        runtime.detector.confidence = confidence
        
        if runtime is None:
            error_msg = f"Could not initialize video source: {payload.video_source}"
            print(f"[start_monitoring] ERROR: {error_msg}")
            return {"status": "error", "message": error_msg}

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

        stop_event.set()
        worker_thread.join(timeout=2)
        if runtime is not None:
            append_runtime_log(runtime, "Monitoring stopped", category="system")
        worker_thread = None
        runtime = None
        return {"status": "stopped"}


@app.post("/clear_zones")
def clear_zones():
    global runtime
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
    mode: Literal["whitelist", "blacklist"]
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
