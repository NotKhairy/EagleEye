import { useEffect } from "react";
import EventLog from "../components/EventLogPanel";
import VideoPlayer from "../components/VideoSection";
import { VIDEO_FEED_URL } from "../services/api";

type DashboardPageProps = {
  onBackToConfig?: () => void;
};

export default function DashboardPage({ onBackToConfig }: DashboardPageProps) {
  useEffect(() => {
    // Log that dashboard mounted
    console.log("Dashboard: Video stream should be active from /start_monitoring API call");
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
