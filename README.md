# EagleEye

Overview

EagleEye is a lightweight surveillance/detection web application combining a Python backend (detection and face recognition) with a React + Vite frontend. It uses a YOLOv8 model for object detection and local face recognition to detect, log, and present events and snapshots.

Purpose

- Capture and analyze video frames for rule-based detections and face recognition.
- Store events and snapshots locally (JSON files) and provide a web UI for monitoring and configuration.

Tech stack

- Backend: Python (detection logic, face recognition, API).
- Detection model: YOLOv8 (yolov8n.pt included).
- Frontend: React + Vite + TypeScript.
- Data: local JSON files in `data/` (event_log.json, snapshots.json).
- Storage: local folders `known_people/`, `uploads/`.

Prerequisites

- Python 3.8+ (virtualenv recommended)
- Node.js 16+ and npm or pnpm

Setup

Linux / macOS

1) Create and activate a Python virtual environment

```bash
python -m venv venv
source venv/bin/activate
```

2) Install Python dependencies

```bash
pip install -r requirements.txt
```

3) Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

Windows (PowerShell)

1) Create and activate a Python virtual environment

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

Windows (Command Prompt)

```cmd
python -m venv venv
.\venv\Scripts\activate.bat
```

2) Install Python dependencies

```powershell
pip install -r requirements.txt
```

3) Install frontend dependencies

```powershell
cd frontend
npm install
cd ..
```

Configuration

- Backend configuration files live in `backend/config/` (global_config.json, rules_config.json, video_source.json, zone_config.json). Adjust these before running if needed.
- The included model file `yolov8n.pt` is used by the detection pipeline (present in repo root and `backend/`).


Run (development)

Linux / macOS

1) Activate virtual environment and start backend

```bash
source venv/bin/activate
python backend/main.py
```

If the backend exposes a FastAPI app, run with Uvicorn:

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

2) Start the frontend

```bash
cd frontend
npm run dev
```

3) Open the web UI in your browser (Vite default)

- http://localhost:5173

Windows (PowerShell / Command Prompt)

1) Activate virtual environment and start backend

PowerShell:

```powershell
.\venv\Scripts\Activate.ps1
python backend\main.py
```

Command Prompt:

```cmd
.\venv\Scripts\activate.bat
python backend\main.py
```

Or run Uvicorn (if installed):

```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

2) Start the frontend

```powershell
cd frontend
npm run dev
```

3) Open the web UI in your browser

- http://localhost:5173

Notes

- Event logs and snapshots are stored in `data/` and can be inspected directly.
- Add face images to `known_people/` following the enrollment process in `face/enroll.py`.
- If you change video sources or zones, update `backend/config/video_source.json` and `backend/config/zone_config.json`.

Troubleshooting

- Ensure the virtual environment is active when running the backend.
- If GPU acceleration is required, ensure your PyTorch installation supports CUDA and the model will pick the device accordingly.

Want me to commit this file or update `README.md` instead?
