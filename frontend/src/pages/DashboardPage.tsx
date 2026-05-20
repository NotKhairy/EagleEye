import { useEffect, useRef, useState } from "react";
import ConfigurationPage from "./ConfigurationPage";
import EventLogPanel from "../components/EventLogPanel";
import SnapshotsPanel from "../components/SnapshotsPanel";
import VideoPlayer from "../components/VideoSection";
import type { Zone } from "../types/types";
import { VIDEO_FEED_URL, clearConfig, clearLogs, clearSnapshots, factoryReset, getMonitoringStatus, getVideoSourceConfig, getVideoSourceInfo, listZones, startMonitoring, stopMonitoring } from "../services/api";

type DashboardTab = "live" | "logs" | "snapshots" | "settings";

function getFilePreviewUrl(videoSource: string | null): string | null {
  if (!videoSource || videoSource === "0") {
    return null;
  }

  const fileName = videoSource.split(/[\\/]/).pop() ?? videoSource;
  return `/api/uploads/${encodeURIComponent(fileName)}`;
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("live");
  const [zones, setZones] = useState<Zone[]>([]);
  const [directVideoUrl, setDirectVideoUrl] = useState<string | null>(null);
  const [monitoringActive, setMonitoringActive] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [streamKey, setStreamKey] = useState(0);
  const autoStartAttemptedRef = useRef(false);

  const loadDashboardContext = async (allowAutoStart = true) => {
    try {
      const [savedZones, sourceInfo, monitoringStatus, persistedSource] = await Promise.all([
        listZones(),
        getVideoSourceInfo(),
        getMonitoringStatus(),
        getVideoSourceConfig(),
      ]);

      setZones(savedZones);
      setMonitoringActive(monitoringStatus.active);

      if (sourceInfo.source_type === "video_file" && sourceInfo.direct_video_url) {
        setDirectVideoUrl(sourceInfo.direct_video_url);
      } else {
        setDirectVideoUrl(getFilePreviewUrl(persistedSource.video_source));
      }

      const shouldAutoStart =
        allowAutoStart &&
        !monitoringStatus.active &&
        Boolean(persistedSource.video_source) &&
        !autoStartAttemptedRef.current;

      if (shouldAutoStart && persistedSource.video_source) {
        autoStartAttemptedRef.current = true;
        try {
          await startMonitoring(persistedSource.video_source);
          setStreamKey((k) => k + 1);
          await loadDashboardContext(false);
          return;
        } catch (startError) {
          console.error("[DASHBOARD] Auto-start failed:", startError);
          alert(`Auto-start failed: ${startError instanceof Error ? startError.message : "Unknown error"}`);
        }
      }
    } catch (error) {
      console.error("[DASHBOARD] Failed to load dashboard context:", error);
    }
  };

  useEffect(() => {
    void loadDashboardContext();
  }, []);

  const handleStopMonitoring = async () => {
    try {
      await stopMonitoring();
      await loadDashboardContext(false);
      setSettingsRevision((value) => value + 1);
      // Refresh the live stream element so it reconnects when monitoring restarts
      setStreamKey((k) => k + 1);
    } catch (error) {
      console.error("[DASHBOARD] Error stopping monitoring:", error);
      alert(`Error stopping monitoring: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleClearConfig = async () => {
    try {
      await clearConfig();
      await loadDashboardContext(false);
      setSettingsRevision((value) => value + 1);
    } catch (error) {
      console.error("[DASHBOARD] Clear config failed:", error);
      alert(`Clear config failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleClearLogs = async () => {
    try {
      await clearLogs();
    } catch (error) {
      console.error("[DASHBOARD] Clear logs failed:", error);
      alert(`Clear logs failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleClearSnapshots = async () => {
    try {
      await clearSnapshots();
    } catch (error) {
      console.error("[DASHBOARD] Clear snapshots failed:", error);
      alert(`Clear snapshots failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleFactoryReset = async () => {
    const confirmed = window.confirm("Factory reset will clear configs, logs, snapshots, known people, and uploads. Continue?");
    if (!confirmed) {
      return;
    }

    try {
      await factoryReset();
      window.location.href = "/configuration";
    } catch (error) {
      console.error("[DASHBOARD] Factory reset failed:", error);
      alert(`Factory reset failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const tabs: Array<{ id: DashboardTab; label: string }> = [
    { id: "live", label: "Live View" },
    { id: "logs", label: "Logs" },
    { id: "snapshots", label: "Snapshots" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden gap-4">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${active ? "border-blue-500 bg-blue-600/80 text-white" : "border-gray-800 bg-[#11161D] text-gray-300 hover:border-gray-700 hover:bg-[#161D27]"}`}
            >
              {tab.label}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
          <span className={`h-2.5 w-2.5 rounded-full ${monitoringActive ? "bg-green-500" : "bg-red-500"}`} />
          <span className="whitespace-nowrap">{monitoringActive ? "Monitoring active" : "Monitoring Paused"}</span>
          <div className="flex flex-wrap items-center gap-2">
            {monitoringActive ? (
              <button
                type="button"
                onClick={() => void handleStopMonitoring()}
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Stop monitoring
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleClearConfig()}
                  className="rounded bg-[#151B22] px-3 py-1.5 text-xs font-semibold hover:bg-[#1B2330]"
                >
                  Clear config
                </button>
                <button
                  type="button"
                  onClick={() => void handleClearLogs()}
                  className="rounded bg-[#151B22] px-3 py-1.5 text-xs font-semibold hover:bg-[#1B2330]"
                >
                  Clear logs
                </button>
                <button
                  type="button"
                  onClick={() => void handleClearSnapshots()}
                  className="rounded bg-[#151B22] px-3 py-1.5 text-xs font-semibold hover:bg-[#1B2330]"
                >
                  Clear snapshots
                </button>
                <button
                  type="button"
                  onClick={() => void handleFactoryReset()}
                  className="rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold hover:bg-amber-800"
                >
                  Factory reset
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex flex-1 min-h-0 gap-4 overflow-hidden px-4 pb-4">
        <div className={activeTab === "live" ? "flex flex-1 gap-4 overflow-hidden" : "hidden"}>
          <div className="flex-1 overflow-hidden rounded-lg border border-gray-800 bg-[#0b0f14]">
            <VideoPlayer key={streamKey} streamSrc={`${VIDEO_FEED_URL}?t=${streamKey}`} directVideoSrc={directVideoUrl} zones={zones} />
          </div>
          <div className="w-90 min-w-[320px] overflow-hidden">
            <EventLogPanel limit={10} compact className="h-full" title="Mini Log" description="Recent monitoring events" />
          </div>
        </div>

        <div className={activeTab === "logs" ? "flex-1 overflow-hidden" : "hidden"}>
          <EventLogPanel limit={200} className="h-full" title="Event Log" description="Persisted monitoring history" />
        </div>

        <div className={activeTab === "snapshots" ? "flex-1 overflow-hidden" : "hidden"}>
          <SnapshotsPanel limit={200} />
        </div>

        <div className={activeTab === "settings" ? "flex flex-1 min-h-0 overflow-hidden rounded-lg border border-gray-800 bg-[#0b0f14]" : "hidden"}>
          <ConfigurationPage
            mode="settings"
            onMonitoringStarted={async () => {
              await loadDashboardContext(false);
              // bump stream key so live view reloads the feed only when monitoring restarts
              setStreamKey((k) => k + 1);
              setActiveTab("live");
            }}
            key={settingsRevision}
          />
        </div>
      </div>
    </div>
  );
}