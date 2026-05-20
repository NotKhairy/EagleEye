import { useMemo, useState, useEffect } from "react";
import type { Zone } from "../types/types";

type VideoPlayerProps = {
    streamSrc: string;
    directVideoSrc?: string | null;
    zones?: Zone[];
};

export default function VideoSection({ streamSrc, directVideoSrc = null, zones = [] }: VideoPlayerProps) {
    const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);

    const zoneElements = useMemo(() => {
        return zones
            .filter((zone) => zone.polygon.length >= 3)
            .map((zone) => {
                const points = zone.polygon.map((point) => `${point.x},${point.y}`).join(" ");
                const anchor = zone.polygon[0];
                return { ...zone, points, anchor };
            });
    }, [zones]);

    useEffect(() => {
        if (!directVideoSrc) return;

        const handler = () => {
            const el = document.querySelector('video[src="' + directVideoSrc + '"]') as HTMLVideoElement | null;
            if (el) {
                void el.play().catch(() => {});
            }
        };

        document.addEventListener('visibilitychange', handler);

        return () => {
            document.removeEventListener('visibilitychange', handler);
        };
    }, [directVideoSrc]);

    return (
        <div className="h-full w-full p-4 flex flex-col">
            <div className="h-full w-full overflow-hidden rounded-lg border border-gray-800 bg-black relative">
                {directVideoSrc ? (
                    <video
                        src={directVideoSrc}
                        className="h-full w-full object-contain"
                        autoPlay
                        muted
                        playsInline
                        preload="auto"
                        controls={false}
                        onLoadedMetadata={(event) => {
                            const video = event.currentTarget;
                            try {
                                video.currentTime = 0;
                            } catch {}
                            // ensure playback starts (some browsers require an explicit play call)
                            void video.play().catch(() => {});
                            if (video.videoWidth > 0 && video.videoHeight > 0) {
                                setFrameSize({ width: video.videoWidth, height: video.videoHeight });
                            }
                            console.log("✓ Direct video connected");
                        }}
                        onCanPlay={() => {
                            // try to continue playback if it was paused by visibility change
                            const el = document.querySelector('video[src="' + directVideoSrc + '"]') as HTMLVideoElement | null;
                            if (el) {
                                void el.play().catch(() => {});
                            }
                        }}
                        onError={() => {
                            console.error("✗ Failed to load direct video from:", directVideoSrc);
                        }}
                        disablePictureInPicture
                    />
                ) : (
                    <img
                        src={streamSrc}
                        alt="Model output stream"
                        className="h-full w-full object-contain"
                        crossOrigin="anonymous"
                        onLoad={(event) => {
                            const img = event.currentTarget;
                            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                                setFrameSize({ width: img.naturalWidth, height: img.naturalHeight });
                            }
                            console.log("✓ Video stream connected");
                        }}
                        onError={() => {
                            console.error("✗ Failed to load video stream from:", streamSrc);
                        }}
                    />
                )}
                {frameSize && zoneElements.length > 0 ? (
                    <svg
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}
                        preserveAspectRatio="xMidYMid meet"
                    >
                        {zoneElements.map((zone) => (
                            <g key={zone.id}>
                                <polygon
                                    points={zone.points}
                                    fill={`${zone.color}33`}
                                    stroke={zone.color}
                                    strokeWidth={3}
                                    vectorEffect="non-scaling-stroke"
                                />
                                <circle
                                    cx={zone.anchor.x}
                                    cy={zone.anchor.y}
                                    r={6}
                                    fill={zone.color}
                                    opacity={0.9}
                                />
                                <text
                                    x={zone.anchor.x + 8}
                                    y={Math.max(zone.anchor.y - 10, 16)}
                                    fill={zone.color}
                                    fontSize="18"
                                    fontWeight="700"
                                    stroke="#000"
                                    strokeWidth="3"
                                    paintOrder="stroke"
                                >
                                    {zone.name}
                                </text>
                            </g>
                        ))}
                    </svg>
                ) : null}
                <div className="absolute bottom-4 left-4 text-xs text-gray-400 bg-black bg-opacity-50 px-2 py-1 rounded">
                    {directVideoSrc ? "Direct Playback" : "Live Stream"}
                </div>
            </div>
        </div>
    );
}