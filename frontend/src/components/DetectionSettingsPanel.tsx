import { useEffect, useRef, useState } from "react";
import type { VideoSourceType, VideoSource, Zone, RuleConfig } from "../types/types";
import type { GlobalConfig } from "../services/api";
import RuleBuilderPanel, { type RuleBuilderPanelHandle } from "./RuleBuilderPanel";

type CameraOption = {
  deviceId: string;
  label: string;
};

type DetectionSettingsPanelProps = {
  videoSourceType: VideoSourceType | undefined;
  videoSource: VideoSource | null;
  zones: Zone[];
  initialRules?: RuleConfig[];
  cameras: CameraOption[];
  selectedCameraId: string | null;
  uploadedVideoName: string | null;
  isLoadingCameras: boolean;
  sourceError: string | null;
  initialFrameSkip?: number;
  initialConfidenceThreshold?: number;
  initialRecipientEmail?: string | null;
  editable?: boolean;
  submitLabel?: string;
  onActivateLiveFeed: () => void;
  onActivateUploadFile: () => void;
  onUploadVideoFile: (file: File) => void;
  onSelectCamera: (deviceId: string) => void;
  onStartMonitoring: (config: GlobalConfig, videoSource: VideoSource, rules: RuleConfig[]) => Promise<void>;
};

export default function DetectionSettingsPanel({
  videoSourceType,
  videoSource,
  zones,
  cameras,
  selectedCameraId,
  uploadedVideoName,
  isLoadingCameras,
  sourceError,
  initialRules = [],
  initialFrameSkip = 2,
  initialConfidenceThreshold = 0.5,
  initialRecipientEmail,
  editable = true,
  submitLabel = "START MONITORING",
  onActivateLiveFeed,
  onActivateUploadFile,
  onUploadVideoFile,
  onSelectCamera,
  onStartMonitoring,
}: DetectionSettingsPanelProps) {
  const selectedCamera =
    cameras.find((camera) => camera.deviceId === selectedCameraId) ?? null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ruleBuilderRef = useRef<RuleBuilderPanelHandle | null>(null);
  const [frameSkip, setFrameSkip] = useState(initialFrameSkip);
  const [confidenceThreshold, setConfidenceThreshold] = useState(initialConfidenceThreshold);
  const [recipientEmail, setRecipientEmail] = useState<string | null | undefined>(initialRecipientEmail);

  useEffect(() => {
    setFrameSkip(initialFrameSkip);
  }, [initialFrameSkip]);

  useEffect(() => {
    setConfidenceThreshold(initialConfidenceThreshold);
  }, [initialConfidenceThreshold]);

  useEffect(() => {
    setRecipientEmail(initialRecipientEmail);
  }, [initialRecipientEmail]);

  const handleStartMonitoring = async () => {
    // Validate constraints
    const constraints: string[] = [];

    if (!videoSourceType || (videoSourceType === "camera" && !selectedCamera) || (videoSourceType === "video_file" && !uploadedVideoName)) {
      constraints.push("Please select a video source.");
    }

    if (constraints.length > 0) {
      alert(constraints.join("\n"));
      return;
    }

    if (!videoSource) {
      alert("Video source is not properly configured.");
      return;
    }

    const rules = ruleBuilderRef.current?.getRules() ?? [];
    console.log(`[CONFIG] Rules ready for monitoring: ${rules.length}`, rules);

    const globalConfig: GlobalConfig = {
      frameSkip,
      confidenceThreshold,
      recipientEmail: recipientEmail ?? undefined,
    };

    await onStartMonitoring(globalConfig, videoSource, rules);
  };

  return (
    <div className={`w-85 h-full min-h-0 shrink-0 overflow-y-auto overscroll-contain border-r border-gray-800 px-4 py-3 flex flex-col gap-3 ${editable ? "" : "pointer-events-none opacity-60"}`}>
      <div>
        <h2 className="text-base font-semibold">System Configuration</h2>
        <p className="text-xs text-gray-400 leading-4">
          Define your detection logic and spatial zones below.
        </p>
      </div>

      <div className="bg-[#11161D] p-3 rounded-lg space-y-3">
        <h3 className="font-semibold text-sm">Detection Settings</h3>

        <div>
          <label className="text-xs text-gray-400">VIDEO SOURCE</label>

          <div className="flex gap-2 mt-1.5">
            <button
              type="button"
              onClick={onActivateLiveFeed}
              className={`px-2.5 py-1 rounded text-xs ${
                videoSourceType === "camera"
                  ? "bg-blue-600"
                  : "bg-black border border-gray-700"
              }`}
            >
              Live Feed
            </button>
            <button
              type="button"
              onClick={() => {
                onActivateUploadFile();
                fileInputRef.current?.click();
              }}
              className={`px-2.5 py-1 rounded text-xs ${
                videoSourceType === "video_file"
                  ? "bg-blue-600"
                  : "bg-black border border-gray-700"
              }`}
            >
              Upload File
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onUploadVideoFile(file);
              }
              event.target.value = "";
            }}
          />

          {videoSourceType === "camera" ? (
            selectedCamera ? (
              <div
                className="mt-2 w-full cursor-not-allowed rounded border border-gray-700 bg-[#0B0F14] p-2 text-sm text-gray-300"
                aria-disabled="true"
              >
                {selectedCamera.label}
              </div>
            ) : (
              <select
                className="w-full mt-1.5 bg-black border border-gray-700 rounded p-2 text-sm"
                value={selectedCameraId ?? ""}
                onChange={(event) => onSelectCamera(event.target.value)}
                disabled={isLoadingCameras || cameras.length === 0}
              >
                <option value="">
                  {isLoadingCameras ? "Loading webcams..." : "Choose a webcam"}
                </option>
                {cameras.map((camera) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label}
                  </option>
                ))}
              </select>
            )
          ) : (
            <div className="mt-2 w-full rounded border border-gray-700 bg-black p-2 text-sm text-gray-500">
              {uploadedVideoName ?? "No upload selected"}
            </div>
          )}

          {sourceError ? (
            <p className="mt-2 text-xs text-red-400">{sourceError}</p>
          ) : null}
        </div>

        <div>
          <label
            className="text-xs text-gray-400 flex items-center justify-between"
            htmlFor="frameSkip"
          >
            <span>Frame Skip</span>
            <span className="text-blue-300">{frameSkip}</span>
          </label>
          <input
            type="range"
            className="w-full mt-1.5"
            id="frameSkip"
            min={1}
            max={30}
            step={1}
            value={frameSkip}
            onChange={(event) => setFrameSkip(Number(event.target.value))}
          />
          <p className="text-[11px] leading-4 text-gray-500">
            Lower value increases detection accuracy but consumes more CPU.
          </p>
        </div>

        <div>
          <label
            className="text-xs text-gray-400 flex items-center justify-between"
            htmlFor="confidenceThreshold"
          >
            <span>Confidence Threshold</span>
            <span className="text-blue-300">
              {confidenceThreshold.toFixed(2)}
            </span>
          </label>
          <input
            type="range"
            className="w-full mt-1.5"
            id="confidenceThreshold"
            min={0.1}
            max={1}
            step={0.01}
            value={confidenceThreshold}
            onChange={(event) =>
              setConfidenceThreshold(Number(event.target.value))
            }
          />
        </div>

        <div>
          <label className="text-xs text-gray-400" htmlFor="recipientEmail">
            Destination Email
          </label>
          <input
            id="recipientEmail"
            type="email"
            placeholder="recipient@example.com"
            className="w-full mt-1.5 bg-black border border-gray-700 rounded p-2 text-sm"
            value={recipientEmail ?? ""}
            onChange={(e) => setRecipientEmail(e.target.value)}
          />
          <p className="text-[11px] leading-4 text-gray-500">
            Email address to receive alert notifications.
          </p>
        </div>
      </div>

      <RuleBuilderPanel ref={ruleBuilderRef} zones={zones} initialRules={initialRules} editable={editable} />


      <button
        onClick={handleStartMonitoring}
        className="mt-auto bg-blue-600 hover:bg-blue-700 py-2 rounded text-sm font-semibold shrink-0"
        disabled={!editable}
      >
        {submitLabel}
      </button>

      <p className="text-[11px] leading-4 text-center text-gray-500">
        Powered by YOLOv8 and DeepSORT.
        <br />
        Developed by Eng. Khaled Saeed.
      </p>
    </div>
  );
}
