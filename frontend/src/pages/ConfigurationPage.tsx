import { useEffect, useRef, useState } from "react";
import DetectionSettingsPanel from "../components/DetectionSettingsPanel";
import ZoneCanvas, { type ZoneCanvasHandle } from "../components/ZoneCanvas";
import FooterStatusBar from "../components/FooterStatusBar";
import type { RuleConfig, VideoSource, VideoSourceType, Zone } from "../types/types";
import { clearRules, clearZones, getGlobalConfig, getMonitoringStatus, getRules, getVideoSourceConfig, getVideoSourceMetadata, listZones, saveRules, saveZone, setGlobalConfig, setVideoSourceConfig, startMonitoring, uploadVideoFile, type GlobalConfig } from "../services/api";

type CameraOption = {
  deviceId: string;
  label: string;
};

type ConfigurationPageProps = {
  onMonitoringStarted: () => void;
  mode?: "setup" | "settings";
};

export default function ConfigurationPage({
  onMonitoringStarted,
  mode = "setup",
}: ConfigurationPageProps) {
  const isSettingsMode = mode === "settings";
  const [videoSourceType, setVideoSourceType] = useState<VideoSourceType | undefined>();
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [isLoadingCameras, setIsLoadingCameras] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadedVideoUrlRef = useRef<string | null>(null);
  const zoneCanvasRef = useRef<ZoneCanvasHandle>(null);
  const [mediaResolution, setMediaResolution] = useState<string>("N/A");
  const [mediaFPS, setMediaFPS] = useState<string>("N/A");
  const [uploadedVideoName, setUploadedVideoName] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [persistedZones, setPersistedZones] = useState<Zone[]>([]);
  const [loadedRules, setLoadedRules] = useState<RuleConfig[]>([]);
  const [initialFrameSkip, setInitialFrameSkip] = useState(2);
  const [initialConfidenceThreshold, setInitialConfidenceThreshold] = useState(0.5);
  const [isMonitoringActive, setIsMonitoringActive] = useState(false);

  const revokeUploadedVideoUrl = () => {
    if (uploadedVideoUrlRef.current) {
      URL.revokeObjectURL(uploadedVideoUrlRef.current);
      uploadedVideoUrlRef.current = null;
    }
  };

  const updateMediaStatsFromStream = (stream: MediaStream | null) => {
    if (!stream) {
      setMediaResolution("N/A");
      setMediaFPS("N/A");
      return;
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      setMediaResolution("N/A");
      setMediaFPS("N/A");
      return;
    }

    const settings = videoTrack.getSettings();
    const width = settings.width;
    const height = settings.height;
    const frameRate = settings.frameRate;

    setMediaResolution(width && height ? `${width} x ${height}` : "N/A");
    setMediaFPS(typeof frameRate === "number" ? frameRate.toFixed(1) : "N/A");
  };

  useEffect(() => {
    if (!isSettingsMode) {
      return;
    }

    let active = true;

    const loadPersistedState = async () => {
      try {
        const [savedZones, savedRules, savedConfig, savedVideoSource, monitoringStatus] = await Promise.all([
          listZones(),
          getRules(),
          getGlobalConfig(),
          getVideoSourceConfig(),
          getMonitoringStatus(),
        ]);

        if (!active) {
          return;
        }

        setPersistedZones(savedZones);
        setZones(savedZones);
        setLoadedRules(savedRules);
        setInitialFrameSkip(savedConfig.frameSkip);
        setInitialConfidenceThreshold(savedConfig.confidenceThreshold);
        setIsMonitoringActive(monitoringStatus.active);

        if (monitoringStatus.active && monitoringStatus.runtime) {
          const runtime = monitoringStatus.runtime;
          setMediaResolution(
            runtime.source_width && runtime.source_height
              ? `${runtime.source_width} x ${runtime.source_height}`
              : "N/A",
          );
          setMediaFPS(typeof runtime.source_fps === "number" ? runtime.source_fps.toFixed(1) : "N/A");
        }

        const persistedSource = savedVideoSource.video_source;
        if (persistedSource) {
          if (persistedSource === "0") {
            setVideoSourceType("camera");
            setSelectedCameraId("0");
            setVideoSource({ type: "camera", deviceId: "0", name: "Default webcam" });
            if (!monitoringStatus.active) {
              setMediaResolution("N/A");
              setMediaFPS("N/A");
            }
          } else {
            const previewPath = `/api/uploads/${encodeURIComponent(persistedSource.split(/[\\/]/).pop() ?? persistedSource)}`;
            setVideoSourceType("video_file");
            setUploadedVideoName(persistedSource.split(/[\\/]/).pop() ?? persistedSource);
            setVideoSource({
              type: "video_file",
              filePath: persistedSource,
              previewUrl: previewPath,
              name: persistedSource.split(/[\\/]/).pop() ?? persistedSource,
            });
            try {
              const metadata = await getVideoSourceMetadata(persistedSource);
              setMediaResolution(
                metadata.source_width && metadata.source_height
                  ? `${metadata.source_width} x ${metadata.source_height}`
                  : "N/A",
              );
              setMediaFPS(typeof metadata.source_fps === "number" ? metadata.source_fps.toFixed(1) : "N/A");
            } catch (metadataError) {
              console.error("[CONFIG] Failed to load persisted video metadata:", metadataError);
            }
          }
        }
      } catch (error) {
        console.error("[CONFIG] Failed to load persisted settings:", error);
      }
    };

    void loadPersistedState();

    return () => {
      active = false;
    };
  }, [isSettingsMode]);

  const replaceStream = (nextStream: MediaStream | null) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    streamRef.current = nextStream;
    setLiveStream(nextStream);
    updateMediaStatsFromStream(nextStream);
  };

  const editable = isSettingsMode ? !isMonitoringActive : true;

  const handleActivateLiveFeed = async () => {
    revokeUploadedVideoUrl();
    setUploadedVideoName(null);
    setVideoSourceType("camera");
    setSelectedCameraId(null);
    setSourceError(null);
    replaceStream(null);
    setVideoSource(null);
    setIsLoadingCameras(true);

    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameraOptions = devices
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Webcam ${index + 1}`,
        }));

      permissionStream.getTracks().forEach((track) => track.stop());
      setCameras(cameraOptions);
      console.log(`[CONFIG] Detected ${cameraOptions.length} cameras:`);
      cameraOptions.forEach((c, i) => {
        console.log(`  [${i}] ${c.label} (deviceId: ${c.deviceId.substring(0, 20)}...)`);
      });

      if (cameraOptions.length === 0) {
        setSourceError("No webcam devices were found.");
      }
    } catch {
      setCameras([]);
      setSourceError("Camera access was blocked. Allow webcam permission and try again.");
    } finally {
      setIsLoadingCameras(false);
    }
  };

  const handleActivateUploadFile = () => {
    revokeUploadedVideoUrl();
    setVideoSourceType("video_file");
    setSelectedCameraId(null);
    setSourceError(null);
    replaceStream(null);
    setVideoSource(null);
    setUploadedVideoName(null);
    setMediaResolution("N/A");
    setMediaFPS("N/A");
  };

  const handleUploadVideoFile = async (file: File) => {
    console.log(`[CONFIG] File selected: ${file.name} (${file.type}, ${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    revokeUploadedVideoUrl();

    const supportProbe = document.createElement("video");
    const typeIsKnown = typeof file.type === "string" && file.type.length > 0;
    const typeSupported = !typeIsKnown || supportProbe.canPlayType(file.type) !== "";
    
    if (!typeSupported && typeIsKnown) {
      const errorMsg = `File MIME type "${file.type}" is not supported by your browser. Use: video/mp4, video/webm, video/quicktime`;
      console.error("[CONFIG]", errorMsg);
      setSourceError(errorMsg);
      setVideoSourceType("video_file");
      setSelectedCameraId(null);
      replaceStream(null);
      setVideoSource(null);
      setUploadedVideoName(file.name);
      setMediaResolution("N/A");
      setMediaFPS("N/A");
      return;
    }
    
    if (!typeIsKnown) {
      console.warn("[CONFIG] File has no MIME type - will attempt to load anyway (may fail if unsupported format)");
    }

    const objectUrl = URL.createObjectURL(file);
    uploadedVideoUrlRef.current = objectUrl;

    setVideoSourceType("video_file");
    setSelectedCameraId(null);
    setSourceError(null);
    replaceStream(null);
    setUploadedVideoName(file.name);
    setVideoSource({
      type: "video_file",
      previewUrl: objectUrl,
      name: file.name,
    });
    setMediaResolution("N/A");
    setMediaFPS("N/A");
    
    // Upload the file to backend first
    try {
      console.log("[CONFIG] Uploading video file to backend...");
      const backendFilePath = await uploadVideoFile(file);
      console.log(`[CONFIG] File uploaded successfully, backend path: ${backendFilePath}`);
      
      setVideoSource({
        type: "video_file",
        filePath: backendFilePath,  // Backend path for API calls
        previewUrl: objectUrl,  // Blob URL for browser preview
        name: file.name,
      });

      const metadata = await getVideoSourceMetadata(backendFilePath);
      setMediaResolution(
        metadata.source_width && metadata.source_height
          ? `${metadata.source_width} x ${metadata.source_height}`
          : "N/A",
      );
      setMediaFPS(typeof metadata.source_fps === "number" ? metadata.source_fps.toFixed(1) : "N/A");
    } catch (err) {
      console.error("[CONFIG] Failed to upload video file:", err);
      setSourceError(`Failed to upload video file: ${err instanceof Error ? err.message : "Unknown error"}`);
      setVideoSource({
        type: "video_file",
        previewUrl: objectUrl,
        name: file.name,
      });
      return;
    }

  };


  const handleSelectCamera = (deviceId: string) => {
    setSelectedCameraId(deviceId || null);
  };

  const handleStartMonitoring = async (globalConfig: GlobalConfig, videoSourceData: VideoSource, rules: RuleConfig[]) => {
    const handle = zoneCanvasRef.current;
    if (!handle) return;

    if (videoSourceData.type === "video_file" && !videoSourceData.filePath) {
      setSourceError("Please wait for the video upload to finish before starting monitoring.");
      return;
    }

    const zones = handle.getZones();
    const { width, height } = handle.getMediaSize();
    const exportWidth = width > 0 ? width : 1;
    const exportHeight = height > 0 ? height : 1;

    try {
      // Save zones and global config
      console.log("[CONFIG] Clearing all zones from backend...");
      await clearZones();
      console.log("[CONFIG] Zones cleared successfully");

      console.log('[CONFIG] Clearing all rules from backend');
      await clearRules(); 
      console.log('[CONFIG] Rules cleared successfully');
      
      for (const zone of zones) {
        await saveZone({
          ...zone,
          polygon: zone.polygon.map((p) => ({
            x: Math.round(p.x * exportWidth),
            y: Math.round(p.y * exportHeight),
          })),
        });
        console.log(`[CONFIG] Saved zone: ${zone.name}`);
      }
      console.log(`[CONFIG] Total zones saved: ${zones.length}`);
      
      await setGlobalConfig(globalConfig);
      console.log("[CONFIG] Global config saved");

      // Determine the video source string to send to backend and persist
      const videoSourceStringLocal: string =
        videoSourceData.type === "camera"
          ? "0"
          : (videoSourceData.filePath || videoSourceData.name || "video.mp4");

      if (videoSourceData.type === "camera") {
        console.log(`[CONFIG] Selected: "${videoSourceData.name}" - opening default camera (index 0)`);
      } else {
        console.log(`[CONFIG] Sending video file: ${videoSourceStringLocal}`);
      }

      await setVideoSourceConfig(videoSourceStringLocal);
      console.log("[CONFIG] Video source config saved");

      await saveRules(rules);
      console.log(`[CONFIG] Total rules saved: ${rules.length}`);

      // IMPORTANT: Release the camera stream before starting backend monitoring
      // This ensures the camera device is not locked by the browser
      console.log("[CONFIG] Releasing camera stream from browser...");
      replaceStream(null);

      // Start monitoring with the video source (previously determined)
      await startMonitoring(videoSourceStringLocal);
    } catch (err) {
      console.error("Failed to start monitoring:", err);
      alert(`Error starting monitoring: ${err instanceof Error ? err.message : "Unknown error"}`);
      return;
    }

    // Navigate to dashboard
    onMonitoringStarted();
  };

  useEffect(() => {
    if (videoSourceType !== "camera" || !selectedCameraId) {
      return;
    }

    let isCancelled = false;

    const startCamera = async () => {
      try {
        setSourceError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedCameraId },
          },
        });

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        replaceStream(stream);

        const selectedCamera = cameras.find((camera) => camera.deviceId === selectedCameraId) ?? null;
        setVideoSource({
          type: "camera",
          deviceId: selectedCameraId,
          name: selectedCamera?.label ?? "Selected webcam",
        });
      } catch {
        setSourceError("The selected webcam could not be opened.");
      }
    };

    startCamera();

    return () => {
      isCancelled = true;
    };
  }, [cameras, selectedCameraId, videoSourceType]);

  useEffect(() => {
    return () => {
      replaceStream(null);
      revokeUploadedVideoUrl();
    };
  }, []);

  const footerStatus = sourceError
    ? "error"
    : videoSourceType === "camera"
      ? liveStream === null
        ? "waiting"
        : "success"
      : videoSource?.previewUrl
        ? "success"
        : "waiting";

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-[#0B0F14] text-white">
      <DetectionSettingsPanel
        videoSourceType={videoSourceType}
        videoSource={videoSource}
        zones={zones}
        initialRules={loadedRules}
        cameras={cameras}
        selectedCameraId={selectedCameraId}
        uploadedVideoName={uploadedVideoName}
        isLoadingCameras={isLoadingCameras}
        sourceError={sourceError}
        initialFrameSkip={initialFrameSkip}
        initialConfidenceThreshold={initialConfidenceThreshold}
        editable={editable}
        submitLabel={isSettingsMode ? "RESUME MONITORING" : "START MONITORING"}
        onActivateLiveFeed={handleActivateLiveFeed}
        onActivateUploadFile={handleActivateUploadFile}
        onUploadVideoFile={handleUploadVideoFile}
        onSelectCamera={handleSelectCamera}
        onStartMonitoring={handleStartMonitoring}
      />
      <div className="flex flex-col flex-1">
        <ZoneCanvas
          ref={zoneCanvasRef}
          liveStream={liveStream}
          videoSource={videoSource}
          onZonesChange={setZones}
          initialZones={persistedZones}
          editable={editable}
        />
        <FooterStatusBar
          streamResolution={mediaResolution}
          fps={mediaFPS}
          type={videoSourceType}
          status={footerStatus}
        />
      </div>

    </div>
  );
}