# backend/Dockerfile
ARG BASE_IMAGE=python:3.11-slim
FROM ${BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install OS deps required by opencv/ffmpeg etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only requirements first for caching
COPY requirements.txt .

RUN pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/
COPY detection/ ./detection/
COPY face/ ./face/
COPY config/ ./config/
COPY data/ ./data/
COPY yolov8n.pt ./yolov8n.pt

# Expose port
EXPOSE 8000

# Use uvicorn to run FastAPI (remove --reload for production)
CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]