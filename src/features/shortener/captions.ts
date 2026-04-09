import type { TranscriptWord } from "@/lib/transcript";
import type { CaptionSegment } from "./types";

/**
 * Groups transcript words into caption blocks for display.
 * Logic:
 * - Max 3 words per block (to prevent overflow).
 * - Break at sentence ends (. ! ?).
 * - Break on long gaps (> 0.8s).
 */
export function groupWordsIntoCaptions(words: TranscriptWord[]): CaptionSegment[] {
  if (!words.length) return [];

  const blocks: CaptionSegment[] = [];
  let currentWords: string[] = [];
  let currentStart = words[0].start;
  let currentEnd = words[0].end;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prevW = words[i - 1];
    
    // Check for break conditions
    const gap = prevW ? w.start - prevW.end : 0;
    const isSentenceEnd = prevW && /[.!?]$/.test(prevW.text);
    const totalLength = currentWords.join(" ").length + w.text.length + 1;
    const isTooLong = currentWords.length >= 5 || (currentWords.length >= 3 && totalLength > 18);
    const isBigGap = gap > 0.8;

    if (i > 0 && (isSentenceEnd || isTooLong || isBigGap)) {
      blocks.push({
        text: wrapText(currentWords.join(" "), 20),
        start: currentStart,
        duration: currentEnd - currentStart,
      });
      currentWords = [w.text];
      currentStart = w.start;
      currentEnd = w.end;
    } else {
      currentWords.push(w.text);
      currentEnd = w.end;
    }
  }

  if (currentWords.length > 0) {
    blocks.push({
      text: wrapText(currentWords.join(" "), 20),
      start: currentStart,
      duration: currentEnd - currentStart,
    });
  }

  return blocks;
}

/**
 * Internal wrapping: split text into multiple lines if too long.
 * Improved to be more balanced.
 */
function wrapText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  
  // Try to find a space near the middle
  const mid = Math.floor(text.length / 2);
  let bestSpace = -1;
  let minDiff = Infinity;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === " ") {
      const diff = Math.abs(i - mid);
      if (diff < minDiff) {
        minDiff = diff;
        bestSpace = i;
      }
    }
  }
  
  if (bestSpace !== -1) {
    return text.substring(0, bestSpace) + "\n" + text.substring(bestSpace + 1);
  }
  return text;
}
