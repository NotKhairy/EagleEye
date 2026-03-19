type VideoPlayerProps = {
    src: string;
};

export default function VideoSection({ src }: VideoPlayerProps) {
    return (
        <div className="h-full w-full p-4">
            <div className="h-full w-full overflow-hidden rounded-lg border border-gray-800 bg-black">
                <img
                    src={src}
                    alt="Model output stream"
                    className="h-full w-full object-contain"
                />
            </div>
        </div>
    );
}