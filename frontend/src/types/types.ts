// src/types/types.ts

/* =========================
   Video Source
========================= */

export type VideoSourceType = "camera" | "video_file";

export interface VideoSource {
  type: VideoSourceType;
  deviceId?: string;
  filePath?: string;  // Backend file path for API calls
  previewUrl?: string;  // Blob URL for browser preview
  name?: string;
}


/* =========================
   Detection Settings
========================= */

export interface DetectionSettings {
  frameSkip: number;
  confidenceThreshold: number;
  selectedObjects: ObjectClass[];
}


/* =========================
   Object Classes
========================= */

export type ObjectClass =
  | "person"
  | "car"
  | "bicycle"
  | "motorcycle"
  | "bus"
  | "truck"
  | "package";


/* =========================
   Geometry
========================= */

export interface Point {
  x: number;
  y: number;
}

export type Polygon = Point[];


/* =========================
   Zones
========================= */

export interface Zone {
  id: string;
  name: string;
  polygon: Polygon;
  color: string;
  rule: ZoneRule;
}


/* =========================
   Zone Rules
========================= */

export type ZoneTriggerType =
  | "enter"
  | "exit"
  | "dwell";

export interface ZoneRule {
  trigger: ZoneTriggerType;
  /** COCO names (lowercase, as YOLO emits). Empty = match any class. */
  objectClasses: string[];
  dwellTime?: number;
  severity: AlertSeverity;
  personIdentity?: PersonIdentityRule | null;
}

export type PersonIdentityMode = "whitelist" | "blacklist";

export interface PersonIdentityRule {
  mode: PersonIdentityMode;
  personIds: string[];
}


/* =========================
   Alert Severity
========================= */

export type AlertSeverity =
  | "info"
  | "warn"
  | "critical";


/* =========================
   Detection Results
========================= */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  id: number;          // tracking ID
  label: ObjectClass;
  confidence: number;
  bbox: BoundingBox;
}


/* =========================
   System Events (Log)
========================= */

export interface EventLogEntry {
  id: string;
  timestamp: string;
  zoneName: string;
  objectClass: ObjectClass | "unknown";
  message: string;
  severity: AlertSeverity;
}


/* =========================
   System Status
========================= */

export type SystemStatus =
  | "idle"
  | "running"
  | "alert"
  | "error";


/* =========================
   Metrics
========================= */

export interface SystemMetrics {
  fps: number;
  trackedObjects: number;
  activeAlerts: number;
}