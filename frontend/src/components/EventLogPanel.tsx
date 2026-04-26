import { useEffect, useState } from "react";
import { getEventLog, type EventLogEntry } from "../services/api";

export default function EventLogPanel() {
    const [entries, setEntries] = useState<EventLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        const loadEntries = async () => {
            try {
                const nextEntries = await getEventLog();
                if (!active) {
                    return;
                }
                setEntries(nextEntries);
                setError(null);
            } catch (loadError) {
                if (!active) {
                    return;
                }
                setError(loadError instanceof Error ? loadError.message : "Failed to load event log");
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        loadEntries();
        const intervalId = window.setInterval(loadEntries, 1500);

        return () => {
            active = false;
            window.clearInterval(intervalId);
        };
    }, []);

    return (
        <div className="h-full flex flex-col rounded-lg border border-gray-800 bg-[#0b0f14] text-gray-100" style={{ width: 340 }}>
            <div className="border-b border-gray-800 px-4 py-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">Event Log</h2>
                <p className="mt-1 text-xs text-gray-500">Live trigger history and monitoring events</p>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {loading ? (
                    <div className="text-sm text-gray-500">Loading event log...</div>
                ) : null}
                {error ? (
                    <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                        {error}
                    </div>
                ) : null}
                {!loading && !error && entries.length === 0 ? (
                    <div className="text-sm text-gray-500">No events yet.</div>
                ) : null}

                {entries.map((entry, index) => {
                    const accentClass =
                        entry.level === "alert"
                            ? "border-amber-500/40 bg-amber-950/20 text-amber-100"
                            : entry.level === "error"
                                ? "border-red-500/40 bg-red-950/20 text-red-100"
                                : "border-sky-500/30 bg-sky-950/20 text-sky-100";

                    return (
                        <article key={`${entry.timestamp}-${index}`} className={`rounded-md border px-3 py-2 text-sm ${accentClass}`}>
                            <div className="flex items-center justify-between gap-3">
                                <span className="font-medium">{entry.message}</span>
                                <span className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-gray-400">
                                    {entry.level}
                                </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-400">
                                <span>{entry.timestamp}</span>
                                <span>{entry.category}</span>
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
    );
}