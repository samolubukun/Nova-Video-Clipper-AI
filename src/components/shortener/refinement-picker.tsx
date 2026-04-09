"use client";

import { RefinementMode } from "@/features/shortener/types";
import { Button } from "@/components/ui/button";
import { Scissors, Clock, ListRestart } from "lucide-react";

interface RefinementPickerProps {
  value: RefinementMode;
  onChange: (value: RefinementMode) => void;
}

const OPTIONS: {
  id: RefinementMode;
  label: string;
  icon: any;
  description: string;
}[] = [
  {
    id: "disfluency",
    label: "Smart Cuts",
    icon: Scissors,
    description: "Remove silence and filler words",
  },
  {
    id: "thirty_seconds",
    label: "30s Short",
    icon: Clock,
    description: "Viral 30-second highlight",
  },
  {
    id: "sixty_seconds",
    label: "60s Short",
    icon: Clock,
    description: "Viral 60-second highlight",
  },
];

export default function RefinementPicker({
  value,
  onChange,
}: RefinementPickerProps) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const isActive = value === opt.id;
        return (
          <Button
            key={opt.id}
            variant={isActive ? "default" : "outline"}
            className={`h-auto p-4 flex flex-col items-start gap-1 rounded-2xl transition-all border-2 ${
              isActive
                ? "border-primary shadow-lg shadow-primary/20"
                : "border-transparent hover:border-primary/30"
            }`}
            onClick={() => onChange(opt.id)}
          >
            <div className="flex items-center gap-2 font-bold">
              <Icon className="w-4 h-4" />
              {opt.label}
            </div>
            <div
              className={`text-xs ${isActive ? "text-primary-foreground/70" : "text-muted-foreground"}`}
            >
              {opt.description}
            </div>
          </Button>
        );
      })}
    </div>
  );
}
