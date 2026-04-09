import { NextResponse } from "next/server";
import { callWithFallback } from "../gemini-refine/llm-fallback";

export const runtime = "nodejs";

const GEMINI_MODEL = "gemini-2.5-flash-lite";

const SMART_CUTS_PROMPT = `You are a professional video editor. Your only task is to clean up the transcript by removing speech fillers while keeping 100% of the meaningful content.

CRITICAL RULES:
1. NEVER paraphrase, rewrite, or change words - only DELETE unwanted tokens
2. NEVER rephrase - keep exact words from the transcript
3. Remove ONLY these: "uh", "um", "like", "you know", "I mean", repeated words, false starts, stammers
4. Keep ALL substantive content - do not cut sentences
5. Output must be grammatically correct after removal
6. Do not reorder words - keep original sequence

Return ONLY this JSON (no explanations):
{
  "trimmed_text": "the cleaned full transcript using only words from input",
  "notes": "what was removed in 1-2 words (e.g., 'uh, um, repeated words')"
}`;

const GENERATION_CONFIG = {
  temperature: 0.2,
  topK: 40,
  topP: 0.9,
};

export async function POST(req) {
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

    const { words } = body || {};
    if (!Array.isArray(words) || words.length === 0) {
      return NextResponse.json(
        { error: "Missing transcript words" },
        { status: 400 },
      );
    }

    // Build transcript text for context (but ensure we use it for matching only)
    const transcriptText = words.map((w) => w.text).join(" ");

    const prompt = `${SMART_CUTS_PROMPT}\n\nTRANSCRIPT:\n${transcriptText}`;
    const response = await callWithFallback(prompt);
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON from response
    let parsed = null;
    let cleanText = text;

    // Extract from markdown if present
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

    try {
      parsed = JSON.parse(cleanText);
    } catch (e) {
      console.error("[Smart Cuts] Failed to parse response:", cleanText);
      return NextResponse.json(
        { error: "Failed to parse Gemini response" },
        { status: 500 },
      );
    }

    // Now match trimmed_text back to source words
    const trimmedText = parsed.trimmed_text || "";
    const matchedWords = matchTextToWords(words, trimmedText);

    return NextResponse.json({
      trimmed_text: trimmedText,
      trimmed_words: matchedWords,
      notes: parsed.notes,
    });
  } catch (error) {
    console.error("[Smart Cuts Error]:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}

// Match cleaned text back to source words
function matchTextToWords(sourceWords, trimmedText) {
  if (!sourceWords?.length || !trimmedText) return [];

  const normalize = (t) => t.toLowerCase().replace(/[^a-z0-9'\s]/g, "");
  const targetTokens = normalize(trimmedText).split(/\s+/).filter(Boolean);

  const matchedIndices = [];
  let sourceIdx = 0;

  for (const token of targetTokens) {
    for (let i = sourceIdx; i < sourceWords.length; i++) {
      const sourceNorm = normalize(sourceWords[i].text);
      if (
        sourceNorm === token ||
        (token.length > 4 && sourceNorm.startsWith(token))
      ) {
        matchedIndices.push(i);
        sourceIdx = i + 1;
        break;
      }
    }
  }

  if (!matchedIndices.length) return [];

  // Take first and last for time range
  const startIdx = Math.min(...matchedIndices);
  const endIdx = Math.max(...matchedIndices);

  return sourceWords.slice(startIdx, endIdx + 1).map((w) => ({
    text: w.text,
    start: w.start,
    end: w.end,
    speaker_id: w.speaker_id ?? null,
  }));
}
