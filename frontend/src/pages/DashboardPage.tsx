import { useEffect } from "react";
import EventLog from "../components/EventLogPanel";
import VideoPlayer from "../components/VideoSection";
import { VIDEO_FEED_URL, stopMonitoring } from "../services/api";

type DashboardPageProps = {
  onBackToConfig?: () => void;
};

export default function DashboardPage({ onBackToConfig }: DashboardPageProps) {
  useEffect(() => {
    // Log that dashboard mounted
    console.log("Dashboard: Video stream should be active from /start_monitoring API call");
  }, []);

  const handleReset = async () => {
    try {
      console.log("[DASHBOARD] Stopping monitoring...");
      await stopMonitoring();
      console.log("[DASHBOARD] Monitoring stopped, returning to configuration");
      
      // Navigate back to configuration
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
          <VideoPlayer src={VIDEO_FEED_URL} />
        </div>
        
        {/* Reset button at bottom */}
        <button
          onClick={handleReset}
          className="mt-4 mb-4 mx-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-semibold transition-colors flex-shrink-0"
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
