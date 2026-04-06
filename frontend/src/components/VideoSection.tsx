import { useMemo, useState } from "react";
import type { Zone } from "../types/types";

type VideoPlayerProps = {
    src: string;
    zones?: Zone[];
};

export default function VideoSection({ src, zones = [] }: VideoPlayerProps) {
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

    return (
        <div className="h-full w-full p-4 flex flex-col">
            <div className="h-full w-full overflow-hidden rounded-lg border border-gray-800 bg-black relative">
                <img
                    src={src}
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
                        console.error("✗ Failed to load video stream from:", src);
                    }}
                />
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
                    Live Stream
                </div>
            </div>
        </div>
    );
}