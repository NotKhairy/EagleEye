import type { Zone } from "../types/types";

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
  Action: {
    desktopPush: boolean;
    emailDigest: string | null;
    saveSnapshotLocally: boolean;
    SMS: string | null;
    Call: string | null;
  };
};

export async function saveZone(zone: Zone): Promise<void> {
  const response = await fetch(`${API_BASE}/zones`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      zone_id: zone.id,
      zone_name: zone.name,
      description: "Detection zone",
      trigger: zone.rule.objectClass === "any" ? "person" : zone.rule.objectClass,
      coordinates: zone.polygon.map((p) => [p.x, p.y]),
      rule: zone.rule.trigger,
      severity: zone.rule.severity,
    }),
  });
  if (!response.ok) {
    await throwWithResponse("Failed to save zone", response);
  }
}

export async function clearZones(): Promise<void> {
  const response = await fetch(`${API_BASE}/clear_zones`, { method: "POST" });
  if (!response.ok) {
    await throwWithResponse("Failed to clear zones", response);
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
