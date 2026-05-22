import type {
  BootStatus,
  MonitoringStatus,
  PersistedRulePayload,
  RuleConfig,
  SnapshotRecord,
  VideoSourceMetadata,
  VideoSourceConfig,
  Zone,
} from "../types/types";

const API_BASE = "/api";
export const VIDEO_FEED_URL = `${API_BASE}/video_feed`;

async function throwWithResponse(prefix: string, response: Response): Promise<never> {
  let details = "";
  try {
    details = await response.text();
  } catch {
    details = "";
  }
  const suffix = details ? ` (${details})` : "";
  throw new Error(`${prefix}: ${response.status} ${response.statusText}${suffix}`.trim());
}

export type GlobalConfig = {
  frameSkip: number;
  confidenceThreshold: number;
  recipientEmail?: string;
};

export type EventLogEntry = {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  data?: Record<string, unknown>;
};

export type VideoSourceInfo = {
  status: "running" | "not_running";
  source_type: "camera" | "video_file" | "unknown";
  direct_video_url: string | null;
  source_width?: number | null;
  source_height?: number | null;
  source_fps?: number | null;
};

type RulePayload = {
  rule_id: string;
  name: string;
  description?: string;
  conditions: Record<string, unknown>;
  severity: string;
};

type SavedZonePayload = {
  zone_id: string;
  zone_name: string;
  coordinates: Array<[number, number]>;
};

const ZONE_COLORS = ["#3D99F5", "#F5A623", "#7ED321", "#D0021B", "#9013FE", "#50E3C2"];

export async function saveZone(zone: Zone): Promise<void> {
  const response = await fetch(`${API_BASE}/zones`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      zone_id: zone.id,
      zone_name: zone.name,
      coordinates: zone.polygon.map((p) => [p.x, p.y]),
    }),
  });
  if (!response.ok) {
    await throwWithResponse("Failed to save zone", response);
  }
}

export async function listZones(): Promise<Zone[]> {
  const response = await fetch(`${API_BASE}/zones`);
  if (!response.ok) {
    await throwWithResponse("Failed to list zones", response);
  }

  const zones = (await response.json()) as SavedZonePayload[];
  return zones.map((zone, index) => ({
    id: String(zone.zone_id),
    name: zone.zone_name,
    color: ZONE_COLORS[index % ZONE_COLORS.length],
    polygon: zone.coordinates.map(([x, y]) => ({ x, y })),
  }));
}

export async function saveRules(rules: RuleConfig[]): Promise<void> {
  const payload: RulePayload[] = rules.map((rule) => ({
    rule_id: rule.id,
    name: rule.name,
    description: rule.name,
    conditions: {
      when: rule.when,
      actions: rule.actions,
    },
    severity: "info",
  }));

  const response = await fetch(`${API_BASE}/save_rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    await throwWithResponse("Failed to save rules", response);
  }
}

export async function listRules(): Promise<RuleConfig[]> {
  const response = await fetch(`${API_BASE}/rules`);
  if (!response.ok) {
    await throwWithResponse("Failed to list rules", response);
  }

  const rules = (await response.json()) as PersistedRulePayload[];
  return rules.map((rule) => ({
    id: rule.rule_id,
    name: rule.name,
    when: rule.conditions.when,
    actions: rule.conditions.actions ?? [],
  }));
}

// Backwards-compatible alias: some files import `getRules`
export const getRules = listRules;

export async function getGlobalConfig(): Promise<GlobalConfig> {
  const response = await fetch(`${API_BASE}/global_config`);
  if (!response.ok) {
    await throwWithResponse("Failed to load global config", response);
  }
  return (await response.json()) as GlobalConfig;
}

export async function getVideoSourceConfig(): Promise<VideoSourceConfig> {
  const response = await fetch(`${API_BASE}/video_source_config`);
  if (!response.ok) {
    await throwWithResponse("Failed to load video source config", response);
  }
  return (await response.json()) as VideoSourceConfig;
}

export async function setVideoSourceConfig(videoSource: string | null): Promise<void> {
  const response = await fetch(`${API_BASE}/video_source_config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_source: videoSource }),
  });
  if (!response.ok) {
    await throwWithResponse("Failed to save video source config", response);
  }
}

export type KnownPerson = { id: string; name: string };

export async function listPeople(): Promise<KnownPerson[]> {
  const response = await fetch(`${API_BASE}/people`);
  if (!response.ok) {
    await throwWithResponse("Failed to list people", response);
  }
  return (await response.json()) as KnownPerson[];
}

export async function createPerson(name: string): Promise<KnownPerson> {
  const response = await fetch(`${API_BASE}/people`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    await throwWithResponse("Failed to create person", response);
  }
  return (await response.json()) as KnownPerson;
}

export async function uploadPersonImages(personId: string, files: File[]): Promise<void> {
  const formData = new FormData();
  for (const f of files) {
    formData.append("files", f);
  }
  const response = await fetch(`${API_BASE}/people/${encodeURIComponent(personId)}/images`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    await throwWithResponse("Failed to upload person images", response);
  }
}

export async function clearZones(): Promise<void> {
  const response = await fetch(`${API_BASE}/clear_zones`, { method: "POST" });
  if (!response.ok) {
    await throwWithResponse("Failed to clear zones", response);
  }
}

export async function clearRules(): Promise<void> {
  const response = await fetch(`${API_BASE}/clear_rules`, { method: "POST" });
  if (!response.ok) {
    await throwWithResponse("Failed to clear rules", response);
  }
}

export async function deleteZone(zoneId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/zones/${encodeURIComponent(zoneId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    await throwWithResponse("Failed to delete zone", response);
  }
}

export async function setGlobalConfig(config: GlobalConfig): Promise<void> {
  const response = await fetch(`${API_BASE}/global_config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    await throwWithResponse("Failed to set global config", response);
  }
}

export async function uploadVideoFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  
  const response = await fetch(`${API_BASE}/upload_video`, {
    method: "POST",
    body: formData,
  });
  
  if (!response.ok) {
    await throwWithResponse("Failed to upload video file", response);
  }
  
  const data = await response.json();
  return data.file_path;
}

export async function startModelProcessing(): Promise<void> {
  const response = await fetch(`${API_BASE}/start`, {
    method: "POST",
  });
  if (!response.ok) {
    await throwWithResponse("Failed to start model processing", response);
  }
}

export async function startMonitoring(videoSource: string): Promise<void> {
  const response = await fetch(`${API_BASE}/start_monitoring`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_source: videoSource }),
  });
  if (!response.ok) {
    await throwWithResponse("Failed to start monitoring", response);
  }
}

export async function stopMonitoring(): Promise<void> {
  const response = await fetch(`${API_BASE}/stop`, {
    method: "POST",
  });
  if (!response.ok) {
    await throwWithResponse("Failed to stop monitoring", response);
  }
}

export async function getBootStatus(): Promise<BootStatus> {
  const response = await fetch(`${API_BASE}/boot_status`);
  if (!response.ok) {
    await throwWithResponse("Failed to load boot status", response);
  }
  return (await response.json()) as BootStatus;
}

export async function getMonitoringStatus(): Promise<MonitoringStatus> {
  const response = await fetch(`${API_BASE}/monitoring_status`);
  if (!response.ok) {
    await throwWithResponse("Failed to load monitoring status", response);
  }
  return (await response.json()) as MonitoringStatus;
}

export async function getSnapshots(limit = 200): Promise<SnapshotRecord[]> {
  const response = await fetch(`${API_BASE}/snapshots?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) {
    await throwWithResponse("Failed to load snapshots", response);
  }
  return (await response.json()) as SnapshotRecord[];
}

export async function clearLogs(): Promise<void> {
  const response = await fetch(`${API_BASE}/clear_logs`, { method: "POST" });
  if (!response.ok) {
    await throwWithResponse("Failed to clear logs", response);
  }
}

export async function clearConfig(): Promise<void> {
  const response = await fetch(`${API_BASE}/clear_config`, { method: "POST" });
  if (!response.ok) {
    await throwWithResponse("Failed to clear configuration", response);
  }
}

export async function clearSnapshots(): Promise<void> {
  const response = await fetch(`${API_BASE}/clear_snapshots`, { method: "POST" });
  if (!response.ok) {
    await throwWithResponse("Failed to clear snapshots", response);
  }
}

export async function factoryReset(): Promise<void> {
  const response = await fetch(`${API_BASE}/factory_reset`, { method: "POST" });
  if (!response.ok) {
    await throwWithResponse("Failed to factory reset", response);
  }
}

export async function getEventLog(limit = 200): Promise<EventLogEntry[]> {
  const response = await fetch(`${API_BASE}/event_log?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) {
    await throwWithResponse("Failed to load event log", response);
  }
  return (await response.json()) as EventLogEntry[];
}

export async function getVideoSourceInfo(): Promise<VideoSourceInfo> {
  const response = await fetch(`${API_BASE}/video_source_info`);
  if (!response.ok) {
    await throwWithResponse("Failed to load video source info", response);
  }
  return (await response.json()) as VideoSourceInfo;
}

export async function getVideoSourceMetadata(videoSource: string): Promise<VideoSourceMetadata> {
  const response = await fetch(`${API_BASE}/video_source_metadata?video_source=${encodeURIComponent(videoSource)}`);
  if (!response.ok) {
    await throwWithResponse("Failed to load video source metadata", response);
  }
  return (await response.json()) as VideoSourceMetadata;
}
