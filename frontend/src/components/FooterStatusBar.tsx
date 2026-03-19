import type { VideoSourceType } from "../types/types";

type FooterStatusBarProps = {
  streamResolution: string;
  fps: string;
  type: VideoSourceType | undefined;
  status: "waiting" |"error" | "success";
};

export default function FooterStatusBar({
  streamResolution,
  fps,
  type,
  status,
}: FooterStatusBarProps) {
  return (
    <div className="border-t border-gray-800 text-xs text-gray-400 px-6 py-2 flex justify-between">

      <div>
        Resolution: {streamResolution}
      </div>

      <div>
        FPS: {fps}
      </div>

      <div>
        Source: {type === "camera" ? "Live Feed" : "Video File"}
      </div>

      <div className={status === "error" ? "text-red-400" : status === "waiting" ? "text-yellow-400" : "text-green-400"}>
        {status === "error" ? "Stream Error" : status === "waiting" ? "Stream Waiting" : "Stream Healthy"}
      </div>

    </div>
  );
}