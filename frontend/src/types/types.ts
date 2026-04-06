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

export interface RuleConfig{
  id: string;
  name: string;
  when: RuleNode;
  actions: RuleAction[];
}

export type RuleAction = "notification" | "email";
export type RuleObject = "PERSON" | "CAR" | string;
export type ZoneEvent = "enter" | "exit" | "in_zone" | "loitering";

export type RuleNode = LogicalNode | PredicateNode;

export type LogicalNode = 
| {
  operator: "AND" | "OR";
  children: RuleNode[];
}
| {
  operator: "NOT";
  child: RuleNode;
};

export type PredicateNode = EnterZonePredicate | ExitZonePredicate | InZonePredicate | LoiteringPredicate;

export interface EnterZonePredicate {
  type: "enter";
  object: RuleObject;
  not: boolean;
  zoneId: string;
}

export interface ExitZonePredicate {
  type: "exit";
  object: RuleObject;
  not: boolean;
  zoneId: string;
}


export interface InZonePredicate {
  type: "in_zone";
  object: RuleObject;
  zoneId: string;
  not: boolean;
}


export interface LoiteringPredicate {
  type: "loitering";
  object: RuleObject;
  zoneId: string;
  durationSeconds: number;
  not: boolean;
}


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
}


/* =========================
   Zone Rules
========================= */

export type rule = {
  id: string;
  name: string;
  description: string;
};


export type ZoneTriggerType =
  | "enter"
  | "exit"
  | "loitering";


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