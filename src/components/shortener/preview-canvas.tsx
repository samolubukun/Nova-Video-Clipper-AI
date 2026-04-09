import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";

type PreviewCanvasProps = {
  videoFile: File | null;
  isPlaying: boolean;
  position: number;
  onPositionChange: (time: number) => void;
  onDurationLoad?: (duration: number) => void;
  onVideoLoad?: (width: number, height: number) => void;
  aspectRatio?: number;
  className?: string;
  focalPointX?: number;
  captions?: { text: string; start: number; duration: number }[];
};

const PreviewCanvas = forwardRef<HTMLVideoElement, PreviewCanvasProps>(({
  videoFile,
  isPlaying,
  position,
  onPositionChange,
  onDurationLoad,
  onVideoLoad,
  aspectRatio = 16 / 9,
  className,
  focalPointX = 0.5,
  captions = [],
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  // Expose the video element to the parent
  useImperativeHandle(ref, () => videoRef.current!);

  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoSrc(url);
      return () => URL.revokeObjectURL(url);
    }
    setVideoSrc(null);
  }, [videoFile]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) video.play().catch(() => {});
    else video.pause();
  }, [isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - position) > 0.1) {
      video.currentTime = position;
    }
  }, [position]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      onPositionChange(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      if (onDurationLoad) onDurationLoad(videoRef.current.duration);
      if (onVideoLoad) onVideoLoad(videoRef.current.videoWidth, videoRef.current.videoHeight);
    }
  };

  const currentCaption = captions.find(
    (c) => position >= c.start && position <= c.start + c.duration
  );

  return (
    <div
      className={cn("relative overflow-hidden bg-black flex items-center justify-center", className)}
      style={{ aspectRatio }}
    >
      {videoSrc && (
        <video
          ref={videoRef}
          src={videoSrc}
          className="w-full h-full"
          style={{ 
            objectFit: "cover",
            objectPosition: `${focalPointX * 100}% center` 
          }}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          playsInline
        />
      )}
      
      {currentCaption && (
        <div className="absolute inset-x-0 bottom-[12%] flex justify-center px-6 pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-300">
           <div className="bg-primary/20 backdrop-blur-xl px-6 py-3 rounded-2xl border border-white/30 text-white text-center font-black text-xl md:text-3xl shadow-[0_0_50px_rgba(138,56,245,0.3)] tracking-tight">
              {currentCaption.text.split("\n").map((line, i) => (
                <div key={i} className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{line}</div>
              ))}
           </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none w-full h-full"
      />
    </div>
  );
});

PreviewCanvas.displayName = "PreviewCanvas";
export default PreviewCanvas;
