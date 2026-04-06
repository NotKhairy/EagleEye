import { useEffect, useState } from "react";
import EventLog from "../components/EventLogPanel";
import VideoPlayer from "../components/VideoSection";
import type { Zone } from "../types/types";
import { VIDEO_FEED_URL, listZones, stopMonitoring } from "../services/api";

export default function DashboardPage() {
  const [zones, setZones] = useState<Zone[]>([]);

  useEffect(() => {
    console.log("Dashboard: Video stream should be active from /start_monitoring API call");

    const loadZones = async () => {
      try {
        const savedZones = await listZones();
        setZones(savedZones);
      } catch (error) {
        console.error("[DASHBOARD] Failed to load zones:", error);
      }
    };

    loadZones();
  }, []);

  const handleReset = async () => {
    try {
      console.log("[DASHBOARD] Stopping monitoring...");
      await stopMonitoring();
      console.log("[DASHBOARD] Monitoring stopped, returning to configuration");
      
      window.location.href = "/configuration";
    } catch (err) {
      console.error("[DASHBOARD] Error stopping monitoring:", err);
      alert(`Error stopping monitoring: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  return (
    <div className="flex flex-1 gap-4 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <VideoPlayer src={VIDEO_FEED_URL} zones={zones} />
        </div>
        <button
          onClick={handleReset}
          className="mt-4 mb-4 mx-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-semibold transition-colors shrink-0"
        >
          ⟲ Reset
        </button>
      </div>

      <div className="overflow-hidden">
        <EventLog />
      </div>
    </div>
  );
}
