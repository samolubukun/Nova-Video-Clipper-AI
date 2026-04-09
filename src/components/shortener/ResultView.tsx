"use client";

import { GeminiConceptChoice, SpeakerPreview } from "@/features/shortener/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Play } from "lucide-react";

interface ResultViewProps {
  concepts: GeminiConceptChoice[];
  selectedConceptId: string | null;
  onSelectConcept: (id: string) => void;
  speakerPreviews: Record<string, SpeakerPreview[]>;
}

export default function ResultView({
  concepts,
  selectedConceptId,
  onSelectConcept,
  speakerPreviews,
}: ResultViewProps) {
  if (!concepts.length) return (
    <div className="p-8 text-center bg-muted/20 rounded-3xl border border-dashed">
      <p className="text-muted-foreground">No concepts generated yet.</p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-1">
      {concepts.map((concept) => (
        <Card
          key={concept.id}
          className={`p-6 cursor-pointer transition-all border-2 rounded-3xl relative overflow-hidden group ${
            selectedConceptId === concept.id
              ? "border-primary bg-card ring-8 ring-primary/5 shadow-2xl shadow-primary/20 scale-[1.02]"
              : "hover:border-primary/30 hover:bg-card border-transparent bg-muted/30 shadow-sm"
          }`}
          onClick={() => onSelectConcept(concept.id)}
        >
          <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className={`w-5 h-5 ${selectedConceptId === concept.id ? "text-primary fill-primary" : "text-muted-foreground"}`} />
          </div>

          <div className="flex items-start gap-4 mb-4">
             <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
               <Sparkles className="w-5 h-5 text-primary" />
             </div>
             <div>
               <h4 className="font-bold text-lg leading-tight mb-1">{concept.title}</h4>
               {concept.estimated_duration_seconds && (
                  <Badge variant="secondary" className="rounded-full font-mono text-xs">
                    {concept.estimated_duration_seconds.toFixed(0)}s
                  </Badge>
               )}
             </div>
          </div>

          <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
            {concept.description || concept.notes}
          </p>

          {speakerPreviews[concept.id] && speakerPreviews[concept.id].length > 0 && (
             <div className="flex flex-wrap gap-2">
                {speakerPreviews[concept.id].map((speaker) => (
                   <div key={speaker.id} className="flex items-center gap-1 bg-card border rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm">
                      {speaker.thumbnails[0] && (
                         <img src={speaker.thumbnails[0].src} className="w-4 h-4 rounded-full object-cover" alt="" />
                      )}
                      <span>{speaker.label}</span>
                   </div>
                ))}
             </div>
          )}
        </Card>
      ))}
    </div>
  );
}
