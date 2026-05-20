import { useEffect, useState } from "react";
import { getSnapshots, type SnapshotRecord } from "../services/api";

const API_BASE = "/api";

function snapshotThumbUrl(snapshotPath: string): string {
  const fileName = snapshotPath.split(/[\\/]/).pop() ?? snapshotPath;
  return `${API_BASE}/uploads/${encodeURIComponent(fileName)}`;
}

type SnapshotsPanelProps = {
  limit?: number;
};

export default function SnapshotsPanel({ limit = 200 }: SnapshotsPanelProps) {
  const [records, setRecords] = useState<SnapshotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<SnapshotRecord | null>(null);

  useEffect(() => {
    let active = true;

    const loadSnapshots = async () => {
      try {
        const nextSnapshots = await getSnapshots(limit);
        if (!active) {
          return;
        }
        setRecords(nextSnapshots);
        setError(null);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load snapshots");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadSnapshots();
    const intervalId = window.setInterval(loadSnapshots, 4000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [limit]);

  useEffect(() => {
    if (!previewRecord) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewRecord(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewRecord]);

  return (
    <div className="h-full flex flex-col rounded-lg border border-gray-800 bg-[#0b0f14] text-gray-100">
      <div className="border-b border-gray-800 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">Snapshots</h2>
        <p className="mt-1 text-xs text-gray-500">Persisted alert frames and trigger context</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? <div className="text-sm text-gray-500">Loading snapshots...</div> : null}
        {error ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        {!loading && !error && records.length === 0 ? (
          <div className="text-sm text-gray-500">No snapshots saved yet.</div>
        ) : null}

        {records.map((record) => (
          <article key={`${record.timestamp}-${record.snapshot_path}`} className="rounded-md border border-gray-800 bg-black/30 p-3">
            <div className="flex gap-3">
              <img
                src={snapshotThumbUrl(record.snapshot_path)}
                alt={record.object_summary}
                className="h-20 w-28 cursor-zoom-in rounded border border-gray-800 object-cover transition hover:opacity-90"
                role="button"
                tabIndex={0}
                onClick={() => setPreviewRecord(record)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPreviewRecord(record);
                  }
                }}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold text-amber-200">{record.object_summary}</h3>
                  <span className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-gray-400">
                    {record.timestamp}
                  </span>
                </div>
                <p className="text-xs text-gray-300">Source: {record.source}</p>
                <p className="text-xs text-gray-400">Rules: {record.rule_names.join(", ") || "n/a"}</p>
                <p className="text-xs text-gray-400">Zones: {record.zone_ids.join(", ") || "n/a"}</p>
                <p className="text-xs text-gray-400">Events: {record.event_count}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      {previewRecord ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm"
          onClick={() => setPreviewRecord(null)}
          role="presentation"
        >
          <div
            className="relative max-h-[92vh] max-w-[92vw] overflow-hidden rounded-xl border border-gray-700 bg-[#0b0f14] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={previewRecord.object_summary}
          >
            <button
              type="button"
              onClick={() => setPreviewRecord(null)}
              className="absolute right-3 top-3 z-10 rounded-full border border-gray-700 bg-black/70 px-3 py-1 text-xs font-medium text-gray-100 transition hover:bg-black"
            >
              Close
            </button>
            <img
              src={snapshotThumbUrl(previewRecord.snapshot_path)}
              alt={previewRecord.object_summary}
              className="block max-h-[92vh] max-w-[92vw] object-contain"
            />
            <div className="border-t border-gray-800 px-4 py-3 text-sm text-gray-300">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-amber-200">{previewRecord.object_summary}</span>
                <span className="text-xs uppercase tracking-[0.16em] text-gray-400">{previewRecord.timestamp}</span>
              </div>
              <div className="mt-1 text-xs text-gray-400">
                Source: {previewRecord.source} · Rules: {previewRecord.rule_names.join(", ") || "n/a"} · Zones: {previewRecord.zone_ids.join(", ") || "n/a"}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}