import { NextResponse } from "next/server";

export const runtime = "nodejs";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing Deepgram API key" },
        { status: 500 },
      );
    }

    const contentType = req.headers.get("content-type") ?? "audio/webm";
    const contentLength = req.headers.get("content-length");

    if (!req.body) {
      return NextResponse.json(
        { error: "Empty request body" },
        { status: 400 },
      );
    }

    console.log(
      `[Deepgram] Buffering file (~${contentLength ? (Number(contentLength) / (1024 * 1024)).toFixed(2) + " MB)" : "..."}`,
    );

    const arrayBuffer = await req.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    const response = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&punctuate=true",
      {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Authorization: `Token ${apiKey}`,
        },
        body: audioBuffer,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Deepgram] API Error:", response.status, errorText);
      return NextResponse.json(
        { error: "Deepgram API error", detail: errorText },
        { status: response.status },
      );
    }

    const result = await response.json();
    console.log("[Deepgram] Transcription complete.");
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Deepgram Critical Error]:", err);
    return NextResponse.json(
      {
        error: "Internal server error during transcription",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
