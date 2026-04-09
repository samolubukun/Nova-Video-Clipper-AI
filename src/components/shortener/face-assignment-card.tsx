"use client";

import { SpeakerFaceThumbnail } from "@/features/shortener/types";
import { Card } from "@/components/ui/card";
import { UserCheck, UserPlus } from "lucide-react";

interface FaceAssignmentCardProps {
  hideThumbnails?: boolean;
  onSelectFace: (face: SpeakerFaceThumbnail) => void;
  faceOptions: SpeakerFaceThumbnail[];
  availableFaceSlots: number[];
  speakerAssignments: Record<string, number>;
}

export default function FaceAssignmentCard({
  hideThumbnails,
  onSelectFace,
  faceOptions,
  availableFaceSlots,
  speakerAssignments,
}: FaceAssignmentCardProps) {
  if (hideThumbnails) return null;

  const assignedSlots = Object.values(speakerAssignments);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {faceOptions.map((face) => {
        const isAssigned = assignedSlots.includes(face.slotIndex);
        return (
          <Card
            key={face.id}
            className={`p-3 cursor-pointer transition-all border-2 rounded-2xl relative group overflow-hidden ${
              isAssigned
                ? "border-primary bg-card shadow-xl shadow-primary/10"
                : "border-border bg-muted/30 hover:border-primary/30"
            }`}
            onClick={() => onSelectFace(face)}
          >
            <div className="aspect-square rounded-lg overflow-hidden relative">
              <img src={face.src} className="w-full h-full object-cover" alt="Detected Face" />
              {isAssigned ? (
                <div className="absolute inset-0 bg-primary/40 backdrop-blur-[2px] flex items-center justify-center animate-in fade-in zoom-in duration-300">
                   <div className="bg-card p-2 rounded-full shadow-lg">
                    <UserCheck className="w-6 h-6 text-primary" />
                   </div>
                </div>
              ) : (
                <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors flex items-center justify-center">
                   <UserPlus className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
