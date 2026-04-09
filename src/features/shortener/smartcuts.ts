import type { TranscriptWord } from "@/lib/transcript";

export interface SmartCutsResult {
  trimmed_text: string;
  trimmed_words: TranscriptWord[];
  notes: string;
}

export const requestSmartCuts = async (
  words: TranscriptWord[],
): Promise<SmartCutsResult> => {
  const response = await fetch("/api/gemini-smart-cuts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ words }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Smart cuts failed");
  }

  return response.json();
};
