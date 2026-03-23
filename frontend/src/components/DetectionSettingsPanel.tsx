import { useRef, useState } from "react";
import type { VideoSourceType, VideoSource } from "../types/types";
import PhoneInput from "react-phone-number-input";
import "react-phone-number-input/style.css";
import type { E164Number } from "libphonenumber-js";
import type { GlobalConfig } from "../services/api";

type CameraOption = {
  deviceId: string;
  label: string;
};

type DetectionSettingsPanelProps = {
  videoSourceType: VideoSourceType | undefined;
  videoSource: VideoSource | null;
  cameras: CameraOption[];
  selectedCameraId: string | null;
  uploadedVideoName: string | null;
  isLoadingCameras: boolean;
  sourceError: string | null;
  onActivateLiveFeed: () => void;
  onActivateUploadFile: () => void;
  onUploadVideoFile: (file: File) => void;
  onSelectCamera: (deviceId: string) => void;
  onStartMonitoring: (config: GlobalConfig, videoSource: VideoSource) => Promise<void>;
};

export default function DetectionSettingsPanel({
  videoSourceType,
  videoSource,
  cameras,
  selectedCameraId,
  uploadedVideoName,
  isLoadingCameras,
  sourceError,
  onActivateLiveFeed,
  onActivateUploadFile,
  onUploadVideoFile,
  onSelectCamera,
  onStartMonitoring,
}: DetectionSettingsPanelProps) {
  const selectedCamera =
    cameras.find((camera) => camera.deviceId === selectedCameraId) ?? null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [frameSkip, setFrameSkip] = useState(2);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [phoneNumber, setPhoneNumber] = useState<E164Number | undefined>();
  const [callPhoneNumber, setCallPhoneNumber] = useState<
    E164Number | undefined
  >();
  const [emailAddress, setEmailAddress] = useState<string>("");

  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const [saveSnapshotEnabled, setSaveSnapshotEnabled] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [callEnabled, setCallEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);


  const handleStartMonitoring = async () => {
    // Validate constraints
    const constraints: string[] = [];

    if (!videoSourceType || (videoSourceType === "camera" && !selectedCamera) || (videoSourceType === "video_file" && !uploadedVideoName)) {
      constraints.push("Please select a video source.");
    }

    if (emailEnabled && !emailAddress.trim()) {
      constraints.push("Email enabled but no email address provided.");
    }

    if (smsEnabled && !phoneNumber) {
      constraints.push("SMS enabled but no phone number provided.");
    }

    if (callEnabled && !callPhoneNumber) {
      constraints.push("Call enabled but no phone number provided.");
    }

    if (constraints.length > 0) {
      alert(constraints.join("\n"));
      return;
    }

    if (!videoSource) {
      alert("Video source is not properly configured.");
      return;
    }

    const globalConfig: GlobalConfig = {
      frameSkip,
      confidenceThreshold,
      Action: {
        desktopPush: desktopEnabled,
        emailDigest: emailEnabled ? emailAddress : null,
        saveSnapshotLocally: saveSnapshotEnabled,
        SMS: smsEnabled ? phoneNumber ?? null : null,
        Call: callEnabled ? callPhoneNumber ?? null : null,
      },
    };

    await onStartMonitoring(globalConfig, videoSource);
  };

  return (
    <div className="w-85 h-full min-h-0 overflow-hidden border-r border-gray-800 px-4 py-3 flex flex-col gap-3">
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

        {/* <div>
          <label className="text-xs text-gray-400">OBJECT CLASSES</label>

          <div className="grid grid-cols-2 gap-1.5 mt-1.5 text-xs leading-4">
            <label><input type="checkbox" defaultChecked /> Person</label>
            <label><input type="checkbox" defaultChecked /> Vehicle / Car</label>
            <label><input type="checkbox" /> Bicycle</label>
            <label><input type="checkbox" /> Motorcycle</label>
            <label><input type="checkbox" /> Bus / Truck</label>
            <label><input type="checkbox" /> Package / Bag</label>
          </div>
        </div> */}
      </div>

      <div className="bg-[#11161D] p-3 rounded-lg space-y-2">
        <h2 className="text-xs font-semibold">Trigger Action</h2>
        <p className="text-[11px] text-gray-400">
          Define the actions to be taken when an alert is triggered.
        </p>
        <br />

        <div>
          <label className="flex justify-between text-xs">
            Desktop Push Notifications
            <input type="checkbox" onChange={(e) => setDesktopEnabled(e.target.checked)} />
          </label>
        </div>

        <div>
          <label className="flex justify-between text-xs">
            Email Alert
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
            />
          </label>
          {emailEnabled && (
            <input
              type="email"
              className="mt-1 w-full rounded border border-gray-700 bg-black p-2 text-[11px] size-5"
              placeholder="Email Address"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
            />
          )}
        </div>

        <label className="flex justify-between text-xs">
          Save Snapshots Folder
          <input type="checkbox" onChange={(e) => setSaveSnapshotEnabled(e.target.checked)} />
        </label>

        <div>
          <label className="flex justify-between text-xs">
            SMS
            <input
              type="checkbox"
              checked={smsEnabled}
              onChange={(e) => setSmsEnabled(e.target.checked)}
            />
          </label>
          {smsEnabled && (
            <PhoneInput
              placeholder="Enter phone number"
              value={phoneNumber}
              onChange={setPhoneNumber}
              defaultCountry="EG"
              className="mt-1 w-full rounded border border-gray-700 bg-black p-2 text-[11px] size-5"
            />
          )}
        </div>

        <div>
          <label className="flex justify-between text-xs">
            Call
            <input
              type="checkbox"
              checked={callEnabled}
              onChange={(e) => setCallEnabled(e.target.checked)}
            />
          </label>
          {callEnabled && (
            <PhoneInput
              placeholder="Enter phone number"
              value={callPhoneNumber}
              onChange={setCallPhoneNumber}
              defaultCountry="EG"
              className="mt-1 w-full rounded border border-gray-700 bg-black p-2 text-[11px] size-5"
            />
          )}
        </div>
      </div>

      <button
        onClick={handleStartMonitoring}
        className="mt-auto bg-blue-600 hover:bg-blue-700 py-2 rounded text-sm font-semibold shrink-0"
      >
        START MONITORING
      </button>

      <p className="text-[11px] leading-4 text-center text-gray-500">
        Powered by YOLOv8 and DeepSORT.
        <br />
        Developed by Eng. Khaled Saeed.
      </p>
    </div>
  );
}
