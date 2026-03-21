import { useEffect, useRef } from "react";

type VideoPlayerProps = {
    src: string;
};

export default function VideoSection({ src }: VideoPlayerProps) {
    const imgRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        const img = imgRef.current;
        if (!img || !src) return;

        img.src = src;
        img.onload = () => {
            console.log("✓ Video stream connected");
        };
        img.onerror = () => {
            console.error("✗ Failed to load video stream from:", src);
        };

        return () => {
            img.onload = null;
            img.onerror = null;
        };
    }, [src]);

    return (
        <div className="h-full w-full p-4 flex flex-col">
            <div className="h-full w-full overflow-hidden rounded-lg border border-gray-800 bg-black relative">
                <img
                    ref={imgRef}
                    src={src}
                    alt="Model output stream"
                    className="h-full w-full object-contain"
                    crossOrigin="anonymous"
                />
                <div className="absolute bottom-4 left-4 text-xs text-gray-400 bg-black bg-opacity-50 px-2 py-1 rounded">
                    Live Stream
                </div>
            </div>
        </div>
    );
}