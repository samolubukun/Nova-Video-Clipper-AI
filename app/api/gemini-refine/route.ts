import { NextResponse } from "next/server";
import { callWithFallback } from "./llm-fallback";
import {
  BASE_INSTRUCTIONS,
  SINGLE_RESPONSE_SCHEMA,
  buildMultiConceptSchema,
  SHORTENING_MODE_INSTRUCTIONS,
} from "./prompts";

export const runtime = "nodejs";

const DEFAULT_GOOGLE_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_SHORTENING_MODE = "disfluency";
const MIN_VARIANT_COUNT = 1;
const MAX_VARIANT_COUNT = 3;
const DEFAULT_VARIANT_COUNT = 1;
const SENTENCE_END_REGEX = /[.!?]["')]]?$/;
const SENTENCE_GAP_SECONDS = 0.8;
const SENTENCE_MIN_COVERAGE = 0.6;

const GENERATION_CONFIG = {
  temperature: 0.2,
  topK: 40,
  topP: 0.9,
};

interface Word {
  text: string;
  start: number;
  end: number;
  speaker_id?: string | null;
}

interface KeepRange {
  start: number;
  end: number;
}

interface TrimmedConcept {
  trimmed_text?: string;
  trimmed_words?: Word[];
  estimated_duration_seconds?: number;
  keep_ranges?: number[][];
  [key: string]: unknown;
}

const isValidShorteningMode = (value: unknown) =>
  typeof value === "string" &&
  Object.hasOwn(SHORTENING_MODE_INSTRUCTIONS, value);

const normalizeVariantCount = (value: unknown) => {
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) return DEFAULT_VARIANT_COUNT;
  return Math.min(MAX_VARIANT_COUNT, Math.max(MIN_VARIANT_COUNT, numeric));
};

const buildInstructions = (mode: string, variantCount: number) => {
  const resolved = isValidShorteningMode(mode) ? mode : DEFAULT_SHORTENING_MODE;
  const focus = SHORTENING_MODE_INSTRUCTIONS[resolved];
  const resolvedVariants = normalizeVariantCount(variantCount);
  const schemaSection =
    resolvedVariants > 1
      ? buildMultiConceptSchema(resolvedVariants, resolved)
      : resolved === "disfluency"
        ? buildMultiConceptSchema(1, resolved)
        : SINGLE_RESPONSE_SCHEMA;

  return `${BASE_INSTRUCTIONS}\n\n${schemaSection}\n\nShortening objective:\n${focus}\n\nImplementation notes:\n- trimmed_text must use only words from TRANSCRIPT_TEXT, in order; deletions only.\n- Keep complete sentences; avoid clipped fragments.\n- estimated_duration_seconds can be a rough estimate.\n- Use notes to briefly describe the main deletions or any unmet constraints.`;
};

const buildTranscriptText = (sourceWords: Word[]) => {
  if (!Array.isArray(sourceWords)) return "";
  const parts: string[] = [];
  sourceWords.forEach((word, index) => {
    const text = typeof word?.text === "string" ? word.text.trim() : "";
    if (!text) return;
    parts.push(text);
    const currentEnd = Number.isFinite(word?.end) ? word.end : null;
    const nextStart = Number.isFinite(sourceWords[index + 1]?.start)
      ? sourceWords[index + 1].start
      : null;
    const gap =
      currentEnd !== null && nextStart !== null ? nextStart - currentEnd : 0;
    if (SENTENCE_END_REGEX.test(text) || gap >= SENTENCE_GAP_SECONDS) {
      parts.push("\n\n");
    }
  });
  return parts
    .join(" ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const normalizeKeepRanges = (value: unknown, maxIndex: number): KeepRange[] => {
  if (!Array.isArray(value)) return [];
  const ranges = (value as unknown[][])
    .map((range) => {
      if (!Array.isArray(range) || range.length < 2) return null;
      const start = Number.parseInt(String(range[0]), 10);
      const end = Number.parseInt(String(range[1]), 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      const clampedStart = Math.min(maxIndex, Math.max(0, start));
      const clampedEnd = Math.min(maxIndex, Math.max(0, end));
      const from = Math.min(clampedStart, clampedEnd);
      const to = Math.max(clampedStart, clampedEnd);
      return { start: from, end: to };
    })
    .filter((r): r is KeepRange => r !== null)
    .sort((a, b) => a.start - b.start);

  const merged: KeepRange[] = [];
  ranges.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  });
  return merged;
};

const normalizeWordToken = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, "");

const tokenizeTranscriptText = (text: string) =>
  String(text || "")
    .split(/\s+/)
    .map(normalizeWordToken)
    .filter(Boolean);

interface SentenceRange {
  start: number;
  end: number;
}

const buildSentenceRanges = (sourceWords: Word[]): SentenceRange[] => {
  if (!Array.isArray(sourceWords) || !sourceWords.length) return [];
  const ranges: SentenceRange[] = [];
  let rangeStart = 0;
  sourceWords.forEach((word, index) => {
    const text = typeof word?.text === "string" ? word.text.trim() : "";
    const endMatch = text ? SENTENCE_END_REGEX.test(text) : false;
    const currentEnd = Number.isFinite(word?.end) ? word.end : null;
    const nextStart = Number.isFinite(sourceWords[index + 1]?.start)
      ? sourceWords[index + 1].start
      : null;
    const gap =
      currentEnd !== null && nextStart !== null ? nextStart - currentEnd : 0;
    if (endMatch || gap >= SENTENCE_GAP_SECONDS) {
      ranges.push({ start: rangeStart, end: index });
      rangeStart = index + 1;
    }
  });
  if (rangeStart < sourceWords.length) {
    ranges.push({ start: rangeStart, end: sourceWords.length - 1 });
  }
  return ranges;
};

const filterIndicesBySentenceCoverage = (
  sourceWords: Word[],
  indices: number[],
): number[] => {
  if (!Array.isArray(sourceWords) || !indices?.length) return indices ?? [];
  const ranges = buildSentenceRanges(sourceWords);
  if (!ranges.length) return indices;
  const keptSet = new Set(indices);
  const strictSet = new Set<number>();
  const looseSet = new Set<number>();
  ranges.forEach((range) => {
    let kept = 0;
    for (let i = range.start; i <= range.end; i += 1) {
      if (keptSet.has(i)) kept += 1;
    }
    if (!kept) return;
    const total = range.end - range.start + 1;
    const coverage = total > 0 ? kept / total : 0;
    for (let i = range.start; i <= range.end; i += 1) {
      looseSet.add(i);
    }
    if (coverage >= SENTENCE_MIN_COVERAGE) {
      for (let i = range.start; i <= range.end; i += 1) {
        strictSet.add(i);
      }
    }
  });
  const strict = Array.from(strictSet).sort((a, b) => a - b);
  const loose = Array.from(looseSet).sort((a, b) => a - b);
  if (!strict.length) {
    return loose.length ? loose : indices;
  }
  if (strict.length < Math.max(5, Math.floor(indices.length * 0.6))) {
    return loose.length ? loose : strict;
  }
  return strict;
};

const buildTrimmedWordsFromIndices = (
  sourceWords: Word[],
  indices: number[],
): Word[] => {
  if (!Array.isArray(sourceWords) || !indices?.length) return [];
  return indices.map((index) => {
    const word = sourceWords[index];
    return {
      text: word.text,
      start: word.start,
      end: word.end,
      speaker_id: word.speaker_id ?? null,
    };
  });
};

const buildTrimmedWordsFromText = (
  sourceWords: Word[],
  trimmedText: string,
) => {
  if (!Array.isArray(sourceWords) || !trimmedText) {
    return { words: [] as Word[], matchRatio: 0, indices: [] as number[] };
  }

  const normalize = (t: string) =>
    String(t || "")
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, "");
  const targetTokens = normalize(trimmedText).split(/\s+/).filter(Boolean);

  if (!targetTokens.length)
    return { words: [] as Word[], matchRatio: 0, indices: [] as number[] };

  const matchedIndices: number[] = [];
  let sourceIdx = 0;

  for (const token of targetTokens) {
    for (let i = sourceIdx; i < sourceWords.length; i++) {
      const sourceNorm = normalize(sourceWords[i].text);
      if (
        sourceNorm === token ||
        (token.length > 3 &&
          sourceNorm.startsWith(token.substring(0, token.length - 1)))
      ) {
        matchedIndices.push(i);
        sourceIdx = i + 1;
        break;
      }
    }
  }

  if (!matchedIndices.length)
    return { words: [] as Word[], matchRatio: 0, indices: [] as number[] };

  const startIdx = Math.min(...matchedIndices);
  const endIdx = Math.max(...matchedIndices);

  const trimmedWords = sourceWords.slice(startIdx, endIdx + 1).map((w) => ({
    text: w.text,
    start: w.start,
    end: w.end,
    speaker_id: w.speaker_id ?? null,
  }));

  const matchRatio = targetTokens.length
    ? matchedIndices.length / targetTokens.length
    : 0;
  return { words: trimmedWords, matchRatio, indices: matchedIndices };
};

const buildTrimmedWordsFromRanges = (
  sourceWords: Word[],
  keepRanges: number[][],
): Word[] => {
  if (!Array.isArray(sourceWords) || sourceWords.length === 0) return [];
  const normalized = normalizeKeepRanges(keepRanges, sourceWords.length - 1);
  const trimmed: Word[] = [];
  normalized.forEach((range) => {
    for (let index = range.start; index <= range.end; index += 1) {
      const word = sourceWords[index];
      if (!word || typeof word.text !== "string" || !word.text.trim()) continue;
      trimmed.push({
        text: word.text,
        start: word.start,
        end: word.end,
        speaker_id: word.speaker_id ?? null,
      });
    }
  });
  return trimmed;
};

const computeEstimatedDuration = (words: Word[]) => {
  if (!Array.isArray(words) || !words.length) return null;
  const total = words.reduce((sum, word) => {
    const start = Number.isFinite(word?.start) ? word.start : 0;
    const end = Number.isFinite(word?.end) ? word.end : start;
    return sum + Math.max(0, end - start);
  }, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(total * 10) / 10;
};

const ensureTrimmedWords = (
  entry: TrimmedConcept,
  sourceWords: Word[],
): TrimmedConcept => {
  if (!entry || typeof entry !== "object") return entry;
  const trimmedText =
    typeof entry.trimmed_text === "string" ? entry.trimmed_text.trim() : "";
  const hasKeepRanges = Array.isArray(entry.keep_ranges);
  let trimmedWords: Word[] = [];
  let trimmedTextAttempt: ReturnType<typeof buildTrimmedWordsFromText> | null =
    null;
  if (trimmedText) {
    trimmedTextAttempt = buildTrimmedWordsFromText(sourceWords, trimmedText);
    if (trimmedTextAttempt.matchRatio >= 0.65) {
      const filteredIndices = filterIndicesBySentenceCoverage(
        sourceWords,
        trimmedTextAttempt.indices,
      );
      trimmedWords = buildTrimmedWordsFromIndices(sourceWords, filteredIndices);
    } else if (trimmedTextAttempt.words.length) {
      console.warn(
        "[Gemini API Route] Trimmed text alignment was low quality, using partial matches",
        trimmedTextAttempt.matchRatio,
      );
      trimmedWords = trimmedTextAttempt.words;
    }
  }
  if (!trimmedWords.length && hasKeepRanges) {
    trimmedWords = buildTrimmedWordsFromRanges(
      sourceWords,
      entry.keep_ranges as number[][],
    );
  }
  if (!trimmedWords.length && trimmedTextAttempt?.indices?.length) {
    const filteredIndices = filterIndicesBySentenceCoverage(
      sourceWords,
      trimmedTextAttempt.indices,
    );
    trimmedWords = buildTrimmedWordsFromIndices(sourceWords, filteredIndices);
  }
  if (!trimmedWords.length && Array.isArray(entry.trimmed_words)) {
    trimmedWords = entry.trimmed_words as Word[];
  }
  const estimated =
    typeof entry.estimated_duration_seconds === "number" &&
    Number.isFinite(entry.estimated_duration_seconds)
      ? entry.estimated_duration_seconds
      : computeEstimatedDuration(trimmedWords);
  return {
    ...entry,
    trimmed_words: trimmedWords,
    estimated_duration_seconds: estimated ?? entry.estimated_duration_seconds,
  };
};

const extractGeminiResponseText = (payload: {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    output_text?: string;
  }>;
}) => {
  const candidate = payload?.candidates?.[0];
  const aggregatedText = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim()
    : (candidate?.output_text?.trim?.() ?? "");
  return aggregatedText;
};

interface GeminiResponse {
  concepts?: TrimmedConcept[];
  [key: string]: unknown;
}

const expandGeminiResponse = (payload: unknown, sourceWords: Word[]) => {
  if (!payload || !Array.isArray(sourceWords)) return null;
  const text = extractGeminiResponseText(
    payload as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        output_text?: string;
      }>;
    },
  );
  if (!text) return null;

  let cleanText = text;
  const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    cleanText = jsonMatch[1].trim();
  } else {
    const firstBrace = cleanText.indexOf("{");
    const lastBrace = cleanText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }
  }

  let parsed: GeminiResponse;
  try {
    parsed = JSON.parse(cleanText);
  } catch (error) {
    console.warn(
      "[Gemini API Route] Failed to parse Gemini response JSON",
      error,
    );
    return null;
  }
  if (Array.isArray(parsed?.concepts)) {
    const concepts = parsed.concepts.map((concept) =>
      ensureTrimmedWords(concept, sourceWords),
    );
    return JSON.stringify({ ...parsed, concepts });
  }
  return JSON.stringify(ensureTrimmedWords(parsed, sourceWords));
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawKeys = (
      process.env.GEMINI_API_KEYS ||
      process.env.GEMINI_API_KEY ||
      ""
    )
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const apiKey = rawKeys[Math.floor(Math.random() * rawKeys.length)];

    if (!apiKey) {
      return NextResponse.json({ error: "Missing API Key" }, { status: 500 });
    }

    const {
      model: requestedModel,
      words,
      shorteningMode,
      variantCount: requestedVariants,
    } = body || {};
    if (!Array.isArray(words) || words.length === 0) {
      return NextResponse.json(
        { error: "Missing transcript words" },
        { status: 400 },
      );
    }

    const sourceWords: Word[] = words;
    const targetModel = (requestedModel || DEFAULT_GOOGLE_MODEL).replace(
      /^models\//,
      "",
    );
    const transcriptText = buildTranscriptText(sourceWords);
    const resolvedShorteningMode = isValidShorteningMode(shorteningMode)
      ? shorteningMode
      : DEFAULT_SHORTENING_MODE;
    const defaultVariantFallback =
      resolvedShorteningMode === "sixty_seconds" ||
      resolvedShorteningMode === "thirty_seconds"
        ? MAX_VARIANT_COUNT
        : DEFAULT_VARIANT_COUNT;
    const variantCount = normalizeVariantCount(
      requestedVariants ?? defaultVariantFallback,
    );
    const instructions = buildInstructions(
      resolvedShorteningMode,
      variantCount,
    );

    const userPrompt = `${instructions}\n\nREQUESTED_VARIANTS: ${variantCount}\nTRANSCRIPT_TEXT:\n${transcriptText}`;

    const response = await callWithFallback(userPrompt);

    const expanded = expandGeminiResponse(response, sourceWords);

    if (!expanded) {
      return NextResponse.json(response);
    }

    const parsed = JSON.parse(expanded);
    const wrapper = {
      candidates: [
        {
          content: {
            parts: [{ text: expanded }],
          },
          output_text: expanded,
        },
      ],
      processed: parsed,
    };

    return NextResponse.json(wrapper);
  } catch (error) {
    console.error("[Gemini SDK POST Error]:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Internal Server Error";
    const isRateLimit =
      errorMessage.includes("429") || errorMessage.includes("quota");

    return NextResponse.json(
      {
        error: isRateLimit
          ? "Rate limit exceeded. Please wait a minute."
          : "Gemini SDK Failure",
        detail: errorMessage,
      },
      { status: isRateLimit ? 429 : 502 },
    );
  }
}
