import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimeRange } from "@/features/shortener/types";

type TimelineScrubberProps = {
  isPlaying: boolean;
  position: number;
  duration: number;
  onTogglePlayback: () => void;
  onPositionChange: (time: number) => void;
  className?: string;
};

const formatTime = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = (value % 60).toFixed(0).padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const TimelineScrubber = ({
  isPlaying,
  position,
  duration,
  onTogglePlayback,
  onPositionChange,
  className,
}: TimelineScrubberProps) => {
  const hasDuration = duration > 0;
  const progress = hasDuration ? (position / duration) * 100 : 0;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
        <div 
          className="absolute h-full bg-primary transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={position}
          onChange={(e) => onPositionChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
};

export default TimelineScrubber;
