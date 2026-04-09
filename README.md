# Nova Video Clipper — AI-Powered Short-Form Video

Nova Video Clipper is an advanced browser-native platform for repurposing long-form video into high-impact shorts. Drop a podcast, interview, or presentation into the browser and get back ready-to-post clips with premium captions, dynamic AI face tracking, and smart cropping.

Everything runs securely via WebAssembly and browser-native AI integrations.

## Key Features

1. **Intelligent Transcription** — Audio is extracted client-side and transcribed with word-level timestamps and speaker diarization.
2. **AI Clip Selection** — Powered by Gemini-2.5-Flash-Lite, the system identifies the most viral moments, hooks, and complete thoughts.
3. **Dynamic AI Face Tracking [v2]** — The 9:16 portrait mode automatically follows the active speaker's face with professional-grade smoothing.
4. **Premium Captions** — Highly readable, customizable captions with smart line-wrapping and phrase-aware grouping.
5. **Real-time Preview** — Instant verification of crops and captions before exporting.
6. **Local Export** — Final videos are rendered and downloaded directly from the browser.

## Tech Stack

| Layer             | Technology                                     |
| ----------------- | ---------------------------------------------- |
| **Frontend**      | Next.js 15, React 18, TypeScript, Tailwind CSS |
| **Video Engine**  | FFmpeg.wasm                                    |
| **Face Tracking** | face-api.js + TensorFlow.js (Live v2 Tracking) |
| **AI Analysis**   | Google Gemini (Google AI Studio)               |
| **Transcription** | Deepgram                                       |

## Quick Start

1. **Clone the repository**:

   ```bash
   git clone https://github.com/samolubukun/Nova-Video-Clipper.git
   cd Nova-Video-Clipper
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Configure Environment**:
   Create a `.env.local` file with your API keys (see `.env.example` for reference).

4. **Launch**:
   ```bash
   npm run dev
   # Access at http://localhost:3000
   ```

## Architecture

```
Video File
  │
  ├─► Audio Extraction (Client-side)
  │
  ├─► AI Transcription (Deepgram) → Word-level timestamps
  │
  ├─► Segment Analysis (Gemini) → Selection of viral clips
  │
  ├─► Dynamic Face Tracking (Native AI) → Centering on active speakers
  │
  └─► Video Rendering (FFmpeg.wasm) → Burnt-in captions & final export
```

## Environment Variables

| Variable                       | Description                                  |
| ------------------------------ | -------------------------------------------- |
| `GEMINI_API_KEY`               | Your Google AI Studio API key                |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | Deepgram API key used by transcription route |
| `GEMINI_PROVIDER`              | Keep as `google` (direct Google AI Studio)   |
| `NEXT_PUBLIC_GEMINI_MODEL`     | Default: `models/gemini-2.5-flash-lite`      |

## License

Built for creators who demand professional quality in seconds.
