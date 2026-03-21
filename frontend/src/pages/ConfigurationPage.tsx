import { useEffect, useRef, useState } from "react";
import DetectionSettingsPanel from "../components/DetectionSettingsPanel";
import ZoneCanvas, { type ZoneCanvasHandle } from "../components/ZoneCanvas";
import FooterStatusBar from "../components/FooterStatusBar";
import type { VideoSource, VideoSourceType } from "../types/types";
import { clearZones, saveZone, setGlobalConfig, startMonitoring, uploadVideoFile, type GlobalConfig } from "../services/api";

type CameraOption = {
  deviceId: string;
  label: string;
};

type ConfigurationPageProps = {
  onMonitoringStarted: () => void;
};

export default function ConfigurationPage({ onMonitoringStarted }: ConfigurationPageProps) {
  const [videoSourceType, setVideoSourceType] = useState<VideoSourceType>();
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

  const replaceStream = (nextStream: MediaStream | null) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    streamRef.current = nextStream;
    setLiveStream(nextStream);
    updateMediaStatsFromStream(nextStream);
  };

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
    revokeUploadedVideoUrl();

    const supportProbe = document.createElement("video");
    const typeIsKnown = typeof file.type === "string" && file.type.length > 0;
    const typeSupported = !typeIsKnown || supportProbe.canPlayType(file.type) !== "";
    if (!typeSupported) {
      setSourceError("This video format is not supported by your browser.");
      setVideoSourceType("video_file");
      setSelectedCameraId(null);
      replaceStream(null);
      setVideoSource(null);
      setUploadedVideoName(file.name);
      setMediaResolution("N/A");
      setMediaFPS("N/A");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    uploadedVideoUrlRef.current = objectUrl;

    setVideoSourceType("video_file");
    setSelectedCameraId(null);
    setSourceError(null);
    replaceStream(null);
    setUploadedVideoName(file.name);
    
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
    } catch (err) {
      console.error("[CONFIG] Failed to upload video file:", err);
      setSourceError(`Failed to upload video file: ${err instanceof Error ? err.message : "Unknown error"}`);
      setVideoSource(null);
      revokeUploadedVideoUrl();
      return;
    }

    // Metadata-based resolution for uploaded files; FPS is not reliably available from file metadata.
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onerror = () => {
      setSourceError("The selected video file could not be loaded.");
      setVideoSource(null);
      setMediaResolution("N/A");
      setMediaFPS("N/A");
      revokeUploadedVideoUrl();
    };
    probe.src = objectUrl;
    probe.onloadedmetadata = () => {
      if (probe.videoWidth > 0 && probe.videoHeight > 0) {
        setSourceError(null);
        setMediaResolution(`${probe.videoWidth} x ${probe.videoHeight}`);
        setMediaFPS("N/A");
      } else {
        setSourceError("The selected video file could not be decoded.");
        setVideoSource(null);
        setMediaResolution("N/A");
        setMediaFPS("N/A");
      }
    };
  };

  const handleSelectCamera = (deviceId: string) => {
    setSelectedCameraId(deviceId || null);
  };

  const handleStartMonitoring = async (globalConfig: GlobalConfig, videoSourceData: VideoSource) => {
    const handle = zoneCanvasRef.current;
    if (!handle) return;

    const zones = handle.getZones();
    const { width, height } = handle.getMediaSize();
    const exportWidth = width > 0 ? width : 1;
    const exportHeight = height > 0 ? height : 1;

    try {
      // Save zones and global config
      console.log("[CONFIG] Clearing all zones from backend...");
      await clearZones();
      console.log("[CONFIG] Zones cleared successfully");
      
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

      // IMPORTANT: Release the camera stream before starting backend monitoring
      // This ensures the camera device is not locked by the browser
      console.log("[CONFIG] Releasing camera stream from browser...");
      replaceStream(null);

      // Determine the video source string to send to backend
      let videoSourceString: string;
      if (videoSourceData.type === "camera") {
        // Always use camera index 0 (default webcam)
        videoSourceString = "0";
        console.log(`[CONFIG] Selected: "${videoSourceData.name}" - opening default camera (index 0)`);
      } else {
        // For video file, use the file path or name
        videoSourceString = videoSourceData.filePath || videoSourceData.name || "video.mp4";
        console.log(`[CONFIG] Sending video file: ${videoSourceString}`);
      }

      // Start monitoring with the video source
      await startMonitoring(videoSourceString);
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
    <div className="flex flex-1 overflow-hidden bg-[#0B0F14] text-white">
      <DetectionSettingsPanel
        videoSourceType={videoSourceType}
        videoSource={videoSource}
        cameras={cameras}
        selectedCameraId={selectedCameraId}
        uploadedVideoName={uploadedVideoName}
        isLoadingCameras={isLoadingCameras}
        sourceError={sourceError}
        onActivateLiveFeed={handleActivateLiveFeed}
        onActivateUploadFile={handleActivateUploadFile}
        onUploadVideoFile={handleUploadVideoFile}
        onSelectCamera={handleSelectCamera}
        onStartMonitoring={handleStartMonitoring}
      />
      <div className="flex flex-col flex-1">
        <ZoneCanvas ref={zoneCanvasRef} liveStream={liveStream} videoSource={videoSource} />
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