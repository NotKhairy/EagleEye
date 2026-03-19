import { useEffect } from "react";
import EventLog from "../components/EventLogPanel";
import VideoPlayer from "../components/VideoSection";
import { startModelProcessing, VIDEO_FEED_URL } from "../services/api";

let hasStartedProcessing = false;

export default function DashboardPage() {
  useEffect(() => {
    if (hasStartedProcessing) {
      return;
    }
    hasStartedProcessing = true;

    const start = async () => {
      try {
        await startModelProcessing();
      } catch (err) {
        console.error("Failed to start model processing:", err);
      }
    };

    start();
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1">
        <VideoPlayer src={VIDEO_FEED_URL} />
      </div>

      <EventLog />
    </div>
  );
}
