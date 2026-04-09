import type { TranscriptWord } from "@/lib/transcript";
import { normalizeGeminiRefinement } from "./normalize";
import type {
  GeminiRefinement,
  GeminiRefinementOptions,
  RefinementMode,
} from "./types";

export const requestGeminiRefinement = async (
  words: TranscriptWord[],
  shorteningMode: RefinementMode,
  options?: GeminiRefinementOptions,
): Promise<{
  refinement: GeminiRefinement;
  fileUploadUsed: boolean;
  rawText: string;
}> => {
  const geminiProvider =
    process.env.NEXT_PUBLIC_GEMINI_PROVIDER?.trim().toLowerCase() ||
    "openrouter";
  const defaultClientModel =
    geminiProvider === "openrouter"
      ? "google/gemini-2.5-flash-lite"
      : "models/gemini-2.5-flash-lite";
  const model =
    process.env.NEXT_PUBLIC_GEMINI_MODEL?.trim() || defaultClientModel;

  const proxyBase =
    process.env.NEXT_PUBLIC_GEMINI_PROXY_URL?.replace(/\/$/, "") ?? "";
  const payload: Record<string, unknown> = {
    model,
    words,
    shorteningMode,
    provider: geminiProvider,
  };
  if (options?.variantCount && options.variantCount > 1) {
    payload.variantCount = options.variantCount;
  }

  const response = await fetch(
    `${proxyBase ? proxyBase : ""}/api/gemini-refine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorMessage = await response.text();
    throw new Error(
      errorMessage || "Gemini transcription refinement request failed.",
    );
  }

  const fileUploadUsed =
    response.headers.get("x-gemini-file-upload") === "true";

  const data = await response.json();

  if (data?.processed) {
    const processed = data.processed;
    if (processed.trimmed_words && processed.trimmed_words.length > 0) {
      return {
        refinement: normalizeGeminiRefinement(processed, words),
        fileUploadUsed: false,
        rawText: processed.trimmed_text || "",
      };
    }
    if (processed.concepts && processed.concepts.length > 0) {
      const valid = processed.concepts.filter(
        (c: {
          trimmed_words?: TranscriptWord[];
        }): c is {
          trimmed_words: TranscriptWord[];
          id?: string;
          trimmed_text?: string;
          start_time?: number;
          end_time?: number;
        } => Array.isArray(c.trimmed_words) && c.trimmed_words.length > 0,
      );
      if (valid.length > 0) {
        return {
          refinement: {
            hook: processed.hook,
            trimmed_words: valid[0].trimmed_words,
            notes: processed.notes,
            start_time: valid[0].start_time,
            end_time: valid[0].end_time,
            estimated_duration_seconds: processed.estimated_duration_seconds,
            concepts: valid,
            default_concept_id: valid[0].id,
          },
          fileUploadUsed: false,
          rawText: valid[0].trimmed_text || "",
        };
      }
    }
  }

  const candidate = data?.candidates?.[0];
  const aggregatedText = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
        .map((part: { text?: string }) => part?.text ?? "")
        .join("")
        .trim()
    : (candidate?.output_text?.trim?.() ?? "");

  if (!aggregatedText) {
    throw new Error("Gemini response did not include any text output.");
  }

  // Sanitize Markdown JSON blocks if present
  let cleanText = aggregatedText;
  const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    cleanText = jsonMatch[1].trim();
  } else {
    // Fallback: look for the first '{' and last '}'
    const firstBrace = cleanText.indexOf("{");
    const lastBrace = cleanText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }
  }

  let parsed: GeminiRefinement;
  try {
    parsed = JSON.parse(cleanText);
  } catch (error) {
    console.error("Gemini raw response (failed to parse)", aggregatedText);
    throw new Error("Gemini response was not valid JSON.");
  }

  return {
    // Pass source words so normalize can convert trimmed_text to trimmed_words
    refinement: normalizeGeminiRefinement(parsed, words),
    fileUploadUsed,
    rawText: aggregatedText,
  };
};
