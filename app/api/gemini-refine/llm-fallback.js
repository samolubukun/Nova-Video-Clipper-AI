import { GoogleGenerativeAI } from "@google/generative-ai";

const LLAMA_API_URL = "https://text-gen-llama.samuel-olubukun.workers.dev/";
const LLAMA_API_KEY = process.env.CLOUDFLARE_LLM_API_KEY;

const GENERATION_CONFIG = {
  temperature: 0.2,
  topK: 40,
  topP: 0.9,
};

const USE_CLOUDFLARE_DIRECTLY = process.env.CLOUDFLARE_WORKER_LLM === "true";
const SELECTED_MODEL = "gemini-2.5-flash-lite";

export const getApiKeys = () => {
  const rawKeys = (
    process.env.GEMINI_API_KEYS ||
    process.env.GEMINI_API_KEY ||
    ""
  )
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return rawKeys[Math.floor(Math.random() * rawKeys.length)];
};

const callGemini = async (prompt, model) => {
  const apiKey = getApiKeys();
  if (!apiKey) throw new Error("Missing API Key");
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    generationConfig: GENERATION_CONFIG,
  });
  const result = await genModel.generateContent(prompt);
  return result.response;
};

const callCloudflareWorker = async (prompt) => {
  if (!LLAMA_API_KEY) throw new Error("Missing CLOUDFLARE_LLM_API_KEY");

  const response = await fetch(LLAMA_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LLAMA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, max_tokens: 4000, history: [] }),
  });

  if (!response.ok)
    throw new Error(`Cloudflare Worker failed: ${await response.text()}`);

  const data = await response.json();
  let responseText =
    data.response || data.generated_text || JSON.stringify(data);

  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    responseText = jsonMatch[1].trim();
  } else {
    const firstBrace = responseText.indexOf("{");
    const lastBrace = responseText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      responseText = responseText.substring(firstBrace, lastBrace + 1);
    }
  }

  return { candidates: [{ content: { parts: [{ text: responseText }] } }] };
};

export const callWithFallback = async (prompt) => {
  // If env says use Cloudflare directly
  if (USE_CLOUDFLARE_DIRECTLY) {
    console.log("[LLM] Using Cloudflare Worker directly");
    return callCloudflareWorker(prompt);
  }

  // Try Gemini first
  try {
    console.log("[LLM] Trying Gemini...");
    return await callGemini(prompt, SELECTED_MODEL);
  } catch (err) {
    const isRateLimit =
      err.message?.includes("429") ||
      err.message?.includes("quota") ||
      err.message?.includes("Rate limit");

    if (isRateLimit && LLAMA_API_KEY) {
      console.log(
        "[LLM] Gemini rate limited, falling back to Cloudflare Worker...",
      );
      return callCloudflareWorker(prompt);
    }

    throw err;
  }
};
