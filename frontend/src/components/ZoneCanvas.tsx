import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Circle, Layer, Line, Stage, Text } from "react-konva";
import type { Point, VideoSource, Zone } from "../types/types";
import ZonePropertiesPanel from "./ZonePropertiesPanel";

const CLOSE_RADIUS = 12;
const ZONE_COLORS = ["#3D99F5", "#F5A623", "#7ED321", "#D0021B", "#9013FE", "#50E3C2"];

export type ZoneCanvasHandle = {
  getZones: () => Zone[];
  getMediaSize: () => { width: number; height: number };
};

type ZoneCanvasProps = {
  liveStream: MediaStream | null;
  videoSource: VideoSource | null;
};

function toKonvaPoints(pts: Point[]): number[] {
  return pts.flatMap((p) => [p.x, p.y]);
}

const ZoneCanvas = forwardRef<ZoneCanvasHandle, ZoneCanvasProps>(function ZoneCanvas(
  { liveStream, videoSource },
  ref
) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [isZoneModalOpen, setIsZoneModalOpen] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 });
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const uploadedVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = liveStream;
  }, [liveStream]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    const updateLiveVideoSize = () => {
      if (element.videoWidth > 0 && element.videoHeight > 0) {
        setMediaSize({ width: element.videoWidth, height: element.videoHeight });
      }
    };

    updateLiveVideoSize();
    element.addEventListener("loadedmetadata", updateLiveVideoSize);
    return () => element.removeEventListener("loadedmetadata", updateLiveVideoSize);
  }, [liveStream]);

  useEffect(() => {
    const element = canvasContainerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  // Escape key cancels drawing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDrawing) {
        setIsDrawing(false);
        setDraftPoints([]);
        setHoverPoint(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDrawing]);

  useImperativeHandle(ref, () => ({
    getZones: () => zones,
    getMediaSize: () => mediaSize,
  }));

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;

  const hasRenderableMedia = mediaSize.width > 0 && mediaSize.height > 0;
  const mediaScale = hasRenderableMedia
    ? Math.min(stageSize.width / mediaSize.width, stageSize.height / mediaSize.height)
    : 0;
  const viewport = {
    x: hasRenderableMedia ? (stageSize.width - mediaSize.width * mediaScale) / 2 : 0,
    y: hasRenderableMedia ? (stageSize.height - mediaSize.height * mediaScale) / 2 : 0,
    width: hasRenderableMedia ? mediaSize.width * mediaScale : 0,
    height: hasRenderableMedia ? mediaSize.height * mediaScale : 0,
  };

  const toStagePoint = (point: Point): Point => ({
    x: viewport.x + point.x * viewport.width,
    y: viewport.y + point.y * viewport.height,
  });

  const toNormalizedPoint = (x: number, y: number): Point | null => {
    if (!hasRenderableMedia || viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }

    const localX = x - viewport.x;
    const localY = y - viewport.y;

    if (localX < 0 || localY < 0 || localX > viewport.width || localY > viewport.height) {
      return null;
    }

    return {
      x: localX / viewport.width,
      y: localY / viewport.height,
    };
  };

  const isNearOrigin = (p: Point): boolean => {
    if (draftPoints.length < 3) return false;
    const origin = toStagePoint(draftPoints[0]);
    const candidate = toStagePoint(p);
    return Math.hypot(candidate.x - origin.x, candidate.y - origin.y) <= CLOSE_RADIUS;
  };

  const nearOrigin = hoverPoint ? isNearOrigin(hoverPoint) : false;
  const showUploadedVideo = videoSource?.type === "video_file" && Boolean(videoSource.filePath);
  const allowOverlayInteraction = isDrawing || videoSource?.type === "camera";

  const handleOverlayClick = (x: number, y: number) => {
    if (!isDrawing) return;
    const pt = toNormalizedPoint(x, y);
    if (!pt) return;
    if (isNearOrigin(pt)) {
      finishPolygon();
      return;
    }
    setDraftPoints((prev) => [...prev, pt]);
  };

  const handleOverlayMouseMove = (x: number, y: number) => {
    if (!isDrawing) return;
    setHoverPoint(toNormalizedPoint(x, y));
  };

  const finishPolygon = () => {
    if (draftPoints.length < 3) return;
    const color = ZONE_COLORS[zones.length % ZONE_COLORS.length];
    const newZone: Zone = {
      id: `zone-${Date.now()}`,
      name: `Zone ${zones.length + 1}`,
      color,
      polygon: [...draftPoints],
      rule: { trigger: "dwell", objectClass: "any", dwellTime: 10, severity: "info" },
    };
    setZones((prev) => [...prev, newZone]);
    setSelectedZoneId(newZone.id);
    setIsDrawing(false);
    setDraftPoints([]);
    setHoverPoint(null);
    setIsZoneModalOpen(true);
  };

  const handleAddZone = () => {
    setIsDrawing(true);
    setDraftPoints([]);
    setHoverPoint(null);
    setSelectedZoneId(null);
    setIsZoneModalOpen(false);
  };

  const handleDeleteZone = () => {
    if (!selectedZoneId) return;
    setZones((prev) => prev.filter((z) => z.id !== selectedZoneId));
    setSelectedZoneId(null);
    setIsZoneModalOpen(false);
  };

  const handleZoneChange = (updated: Zone) => {
    setZones((prev) => prev.map((z) => (z.id === updated.id ? updated : z)));
  };

  const handleSaveZone = async (zone: Zone) => {
    setZones((prev) => prev.map((z) => (z.id === zone.id ? zone : z)));
    setIsZoneModalOpen(false);
    setSelectedZoneId(zone.id);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Header bar */}
      <div className="flex justify-between items-center border-b border-gray-800 px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold tracking-widest text-gray-300">
            ZONE CONFIGURATION CANVAS
          </h3>
          {isDrawing && (
            <span className="text-xs bg-blue-600 px-2 py-1 rounded animate-pulse">
              Click to add vertices · click origin to close · Esc to cancel
            </span>
          )}
        </div>

        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={handleAddZone}
            disabled={isDrawing}
            className="bg-[#151B22] px-3 py-1 rounded disabled:opacity-40"
          >
            + Add Zone
          </button>
          <button
            type="button"
            onClick={handleDeleteZone}
            disabled={!selectedZoneId || isDrawing}
            className="text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete Zone
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex justify-center items-center p-6 relative overflow-hidden">

        {/* Background: live feed or placeholder image */}
        <div
          ref={canvasContainerRef}
          className="relative h-full w-full overflow-hidden rounded-lg border border-gray-800 bg-black"
        >
          {videoSource?.type === "camera" && liveStream ? (
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
          ) : showUploadedVideo ? (
            <video
              ref={uploadedVideoRef}
              src={videoSource?.filePath}
              controls
              playsInline
              onLoadedMetadata={(event) => {
                const el = event.currentTarget;
                if (el.videoWidth > 0 && el.videoHeight > 0) {
                  setMediaSize({ width: el.videoWidth, height: el.videoHeight });
                }
              }}
              className="h-full w-full object-contain"
            />
          ) : (
            <img src="/demo-video.jpg" className="h-full w-full object-contain" />
          )}

          <Stage
            width={stageSize.width}
            height={stageSize.height}
            className="absolute inset-0"
            style={{
              cursor: isDrawing ? (nearOrigin ? "cell" : "crosshair") : "default",
              pointerEvents: allowOverlayInteraction ? "auto" : "none",
            }}
            onClick={(event) => {
              const pointer = event.target.getStage()?.getPointerPosition();
              if (!pointer) return;
              handleOverlayClick(pointer.x, pointer.y);
            }}
            onMouseMove={(event) => {
              const pointer = event.target.getStage()?.getPointerPosition();
              if (!pointer) return;
              handleOverlayMouseMove(pointer.x, pointer.y);
            }}
            onMouseLeave={() => setHoverPoint(null)}
          >
            <Layer>
              {zones.map((zone) => (
                <Line
                  key={zone.id}
                  points={toKonvaPoints(zone.polygon.map(toStagePoint))}
                  closed
                  fill={zone.color + "30"}
                  stroke={selectedZoneId === zone.id ? "#ffffff" : zone.color}
                  strokeWidth={selectedZoneId === zone.id ? 2 : 1.5}
                  onClick={(event) => {
                    if (isDrawing) return;
                    event.cancelBubble = true;
                    setSelectedZoneId(zone.id);
                    setIsZoneModalOpen(true);
                  }}
                />
              ))}

              {zones.map((zone) => (
                <Text
                  key={`${zone.id}-label`}
                  x={toStagePoint(zone.polygon[0] ?? { x: 0, y: 0 }).x}
                  y={toStagePoint(zone.polygon[0] ?? { x: 0, y: 0 }).y - 14}
                  text={zone.name}
                  fill={zone.color}
                  fontSize={11}
                  fontStyle="bold"
                  listening={false}
                />
              ))}

              {isDrawing && draftPoints.length > 1 && (
                <Line
                  points={toKonvaPoints(draftPoints.map(toStagePoint))}
                  closed={draftPoints.length >= 3}
                  fill={draftPoints.length >= 3 ? "#3D99F520" : undefined}
                  stroke="#3D99F5"
                  strokeWidth={1.5}
                  dash={[5, 3]}
                />
              )}

              {isDrawing && hoverPoint && draftPoints.length > 0 && (
                <Line
                  points={[
                    toStagePoint(draftPoints[draftPoints.length - 1]).x,
                    toStagePoint(draftPoints[draftPoints.length - 1]).y,
                    toStagePoint(hoverPoint).x,
                    toStagePoint(hoverPoint).y,
                  ]}
                  stroke="#3D99F5"
                  strokeWidth={1.5}
                  dash={[4, 3]}
                  opacity={0.7}
                />
              )}

              {isDrawing && draftPoints.map((pt, index) => (
                <Circle
                  key={`${pt.x}-${pt.y}-${index}`}
                  x={toStagePoint(pt).x}
                  y={toStagePoint(pt).y}
                  radius={index === 0 ? 5 : 4}
                  fill={index === 0 ? "#4ade80" : "#3D99F5"}
                  stroke="white"
                  strokeWidth={1.5}
                />
              ))}

              {isDrawing && draftPoints.length >= 3 && (
                <Circle
                  x={toStagePoint(draftPoints[0]).x}
                  y={toStagePoint(draftPoints[0]).y}
                  radius={CLOSE_RADIUS}
                  fillEnabled={false}
                  stroke="#4ade80"
                  strokeWidth={1.5}
                  dash={[3, 2]}
                  opacity={nearOrigin ? 1 : 0.45}
                />
              )}
            </Layer>
          </Stage>

          {videoSource?.type === "camera" && liveStream && (
            <div className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/70 px-3 py-1 text-xs text-gray-200">
              {videoSource.name ?? "Live webcam"}
            </div>
          )}
        </div>

        <ZonePropertiesPanel
          isOpen={isZoneModalOpen}
          zone={selectedZone}
          onClose={() => setIsZoneModalOpen(false)}
          onChange={handleZoneChange}
          onSave={handleSaveZone}
        />

      </div>

    </div>
  );
});

export default ZoneCanvas;