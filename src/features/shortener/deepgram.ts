export interface DeepgramTranscriptResponse {
  results: {
    channels: Array<{
      alternatives: Array<{
        transcript: string;
        words: Array<{
          word: string;
          start: number;
          end: number;
          confidence: number;
          speaker?: number;
        }>;
      }>;
    }>;
  };
}

export const transcribeWithDeepgram = async (
  audioBlob: Blob,
  retryCount = 0
): Promise<DeepgramTranscriptResponse> => {
  try {
    const response = await fetch("/api/transcribe-deepgram", {
      method: "POST",
      body: audioBlob,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.detail || errorData.error || "Transcription through proxy failed";
      
      // If we hit a timeout and have retries left, try one more time
      if (errorMessage.includes("timeout") && retryCount < 1) {
        console.warn("[Deepgram] Upload timed out. Retrying...");
        await new Promise(r => setTimeout(r, 2000));
        return transcribeWithDeepgram(audioBlob, retryCount + 1);
      }
      
      throw new Error(`Deepgram transcription failed: ${errorMessage}`);
    }

    return response.json();
  } catch (error) {
    if (retryCount < 1) {
      console.warn("[Deepgram] Network error. Retrying once...");
      await new Promise(r => setTimeout(r, 2000));
      return transcribeWithDeepgram(audioBlob, retryCount + 1);
    }
    throw error;
  }
};
