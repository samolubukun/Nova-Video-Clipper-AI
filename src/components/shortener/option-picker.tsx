import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type OptionPickerOption<T extends string> = {
  id: T;
  label: string;
};

export type OptionPickerProps<T extends string> = {
  options: OptionPickerOption<T>[];
  value: T;
  onChange: (id: T) => void;
  renderPreview: (id: T, isActive: boolean) => ReactNode;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

const OptionPicker = <T extends string>({
  options,
  value,
  onChange,
  renderPreview,
  disabled = false,
  className,
  ariaLabel = "Options",
}: OptionPickerProps<T>) => (
  <div
    className={cn("flex flex-wrap gap-3", className)}
    role="group"
    aria-label={ariaLabel}
  >
    {options.map((option) => {
      const isActive = value === option.id;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            "flex flex-1 min-w-[70px] sm:w-24 flex-col items-center gap-2 rounded-xl border px-2 py-3 sm:px-3 text-[10px] sm:text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isActive
              ? "border-primary bg-primary/5 text-primary"
              : "border-muted text-muted-foreground hover:border-muted-foreground/60 bg-card",
            disabled && "pointer-events-none opacity-50"
          )}
          aria-pressed={isActive}
          disabled={disabled}
        >
          <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center">
            {renderPreview(option.id, isActive)}
          </div>
          <span className="text-center line-clamp-1">{option.label}</span>
        </button>
      );
    })}
  </div>
);

export default OptionPicker;
