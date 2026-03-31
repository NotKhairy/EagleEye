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
      trigger: zone.rule.objectClasses,
      coordinates: zone.polygon.map((p) => [p.x, p.y]),
      rule: zone.rule.trigger,
      severity: zone.rule.severity,
      personIdentity: zone.rule.personIdentity ?? null,
    }),
  });
  if (!response.ok) {
    await throwWithResponse("Failed to save zone", response);
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
