"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import * as faceapi from "face-api.js";
import type { FFmpeg } from "@ffmpeg/ffmpeg";

// ffmpeg.wasm singleton
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;

const loadFFmpeg = async () => {
  if (ffmpegLoaded && ffmpegInstance) return ffmpegInstance;

  if (!ffmpegInstance) {
    // Dynamic import to avoid SSR issues
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    ffmpegInstance = new FFmpeg();
  }

  // Use local files first, fallback to CDN
  const baseURL = "/ffmpeg";
  try {
    await ffmpegInstance.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });
  } catch {
    // Fallback to CDN if local files fail
    const cdnBaseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpegInstance.load({
      coreURL: await toBlobURL(
        `${cdnBaseURL}/ffmpeg-core.js`,
        "text/javascript",
      ),
      wasmURL: await toBlobURL(
        `${cdnBaseURL}/ffmpeg-core.wasm`,
        "application/wasm",
      ),
    });
  }
  ffmpegLoaded = true;
  return ffmpegInstance;
};

import { extractDeepgramTranscriptWords } from "@/lib/transcript";
import type {
  DeepgramTranscriptResponse,
  TranscriptWord,
} from "@/lib/transcript";
import { transcribeWithDeepgram } from "@/features/shortener/deepgram";
import { requestGeminiRefinement } from "@/features/shortener/gemini";
import { requestSmartCuts } from "@/features/shortener/smartcuts";
import { buildKeepRangesFromWords } from "@/features/shortener/keepRanges";
import { useShortenerWorkflow } from "@/features/shortener/use-shortener-workflow";
import type {
  CaptionSegment,
  FaceBounds,
  GeminiConceptChoice,
  GeminiRefinement,
  ProcessingStepId,
  RangeMapping,
  RefinementMode,
  SpeakerFaceThumbnail,
  SpeakerPreview,
  SpeakerSnippet,
  SpeakerTemplateId,
  TimeRange,
} from "@/features/shortener/types";
import {
  FileVideo,
  Scissors,
  Sparkles,
  Download,
  Upload,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Settings,
  AlertCircle,
  FileText,
  Trash2,
  Loader2,
} from "lucide-react";

import AppHeader from "@/components/shortener/app-header";
import AspectRatioPicker from "@/components/shortener/aspect-ratio-picker";
import ResultView from "./components/shortener/ResultView";
import FaceAssignmentCard from "@/components/shortener/face-assignment-card";
import { Button } from "@/components/ui/button";
import PreviewCanvas from "@/components/shortener/preview-canvas";
import { ThemeProvider } from "@/components/theme-provider";
import DebugModal from "@/components/shortener/debug-modal";
import RefinementPicker from "@/components/shortener/refinement-picker";
import ProcessingStatusCard from "@/components/shortener/processing-status-card";
import TemplatePicker from "@/components/shortener/template-picker";
import TimelineScrubber from "@/components/shortener/timeline-scrubber";

import { SPEAKER_TEMPLATE_OPTIONS } from "@/features/shortener/templates";
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_ASPECT_RATIO_ID,
  resolveAspectRatio,
} from "@/features/shortener/aspect-ratios";
import { calculateSceneDimensions } from "@/features/shortener/scene-dimensions";
import { groupWordsIntoCaptions } from "@/features/shortener/captions";
import {
  coerceHookText,
  buildHookTextFromWords,
  HOOK_DEFAULT_TEXT,
} from "@/features/shortener/hook-text";

const HOOK_DURATION_SECONDS = 5;
const DEFAULT_ANALYSIS_SECONDS = 30;

export default function App() {
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "true";

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineDuration, setTimelineDuration] = useState(0);
  const [timelinePosition, setTimelinePosition] = useState(0);
  const [timelineSegments, setTimelineSegments] = useState<RangeMapping[]>([]);
  const [isScrubbingTimeline, setIsScrubbingTimeline] = useState(false);
  const [targetAspectRatioId, setTargetAspectRatioId] = useState(
    DEFAULT_ASPECT_RATIO_ID,
  );

  const [speakerAssignments, setSpeakerAssignments] = useState<
    Record<string, number>
  >({});
  const [speakerThumbnails, setSpeakerThumbnails] = useState<
    SpeakerFaceThumbnail[]
  >([]);
  const [speakerAssignedThumbnails, setSpeakerAssignedThumbnails] = useState<
    Record<string, string>
  >({});
  const [availableFaceSlots, setAvailableFaceSlots] = useState<number[]>(
    Array.from({ length: 6 }, (_, i) => i),
  );
  const [isSpeakerIdentificationActive, setIsSpeakerIdentificationActive] =
    useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [isSpeakerAudioPlaying, setIsSpeakerAudioPlaying] = useState(false);
  const [hasPlayedSpeakerAudio, setHasPlayedSpeakerAudio] = useState(false);
  const [speakerSnippets, setSpeakerSnippets] = useState<SpeakerSnippet[]>([]);
  const [speakerTemplateId, setSpeakerTemplateId] =
    useState<SpeakerTemplateId>("none");

  const [isFaceCropPending, setIsFaceCropPending] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [sourceVideoSize, setSourceVideoSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [textHookEnabled, setTextHookEnabled] = useState(true);
  const [transcriptDebug, setTranscriptDebug] =
    useState<DeepgramTranscriptResponse | null>(null);
  const [geminiDebug, setGeminiDebug] = useState<string | null>(null);
  const [geminiFaceDebug, setGeminiFaceDebug] = useState<string | null>(null);
  const [geminiFaceThumbnail, setGeminiFaceThumbnail] = useState<string | null>(
    null,
  );
  const [captionDebug, setCaptionDebug] = useState<Record<
    string,
    CaptionSegment[]
  > | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [currentTranscriptWords, setCurrentTranscriptWords] = useState<
    TranscriptWord[]
  >([]);
  const [sourceVideoDuration, setSourceVideoDuration] = useState(0);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isFaceDebugLoading, setIsFaceDebugLoading] = useState(false);
  const [debugExportMetrics, setDebugExportMetrics] = useState<string | null>(
    null,
  );
  const [preloadScript, setPreloadScript] = useState<string | null>(null);
  const [isPreloadScriptExporting, setIsPreloadScriptExporting] =
    useState(false);
  const [isImportScriptOpen, setIsImportScriptOpen] = useState(false);
  const [importScriptText, setImportScriptText] = useState("");
  const [importScriptError, setImportScriptError] = useState<string | null>(
    null,
  );
  const [isImportingScript, setIsImportingScript] = useState(false);

  const [isCreatingVideo, setIsCreatingVideo] = useState(false);
  const [focalPoints, setFocalPoints] = useState<Record<string, number>>({});
  const [isFaceApiLoaded, setIsFaceApiLoaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState<string | null>(null);
  const [analysisEstimate, setAnalysisEstimate] = useState<any>(null);
  const [speakerQueue, setSpeakerQueue] = useState<string[]>([]);
  const [hidePreloadThumbnails, setHidePreloadThumbnails] = useState(false);
  const [speakerFaceSlots, setSpeakerFaceSlots] = useState<
    Record<string, FaceBounds[]>
  >({});
  const [primaryFaceSlots, setPrimaryFaceSlots] = useState<FaceBounds[]>([]);
  const [faceOptions, setFaceOptions] = useState<SpeakerFaceThumbnail[]>([]);
  const [analysisStartAt, setAnalysisStartAt] = useState<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const speakerPlaybackTimeoutRef = useRef<number | null>(null);
  const speakerAssignmentsRef = useRef<Record<string, number>>({});
  const speakerTemplateIdRef = useRef<SpeakerTemplateId>("none");
  const speakerSnippetsRef = useRef<SpeakerSnippet[]>([]);
  const clipSpeakerMapRef = useRef<Map<number, string | null>>(new Map());
  const lastRefinementRef = useRef<GeminiRefinement | null>(null);
  const lastDesiredVariantsRef = useRef<number>(1);
  const lastRefinementModeRef = useRef<RefinementMode>("disfluency");
  const baseClipIdsRef = useRef<number[]>([]);
  const clipRangesRef = useRef<TimeRange[]>([]);
  const preloadRunIdRef = useRef(0);
  const pendingWorkflowRef = useRef<any>(null);
  const preloadSnapshotRef = useRef<any>(null);
  const debugThumbnailRef = useRef<string | null>(null);

  const textHookTextRef = useRef<string | null>(null);
  const textHookDurationRef = useRef(HOOK_DURATION_SECONDS);

  const [textHookText, setTextHookText] = useState<string | null>(null);

  const {
    refinementMode,
    setRefinementMode,
    autoProcessing,
    setAutoProcessing,
    autoProcessStatuses,
    autoProcessingError,
    setAutoProcessingError,
    conceptChoices,
    setConceptChoices,
    selectedConceptId,
    setSelectedConceptId,
    isApplyingConcept,
    setIsApplyingConcept,
    applyingConceptId,
    setApplyingConceptId,
    hasStartedWorkflow,
    updateProcessingStatus,
    resetWorkflowState,
    beginWorkflow,
  } = useShortenerWorkflow();

  const resetPreloadState = useCallback(() => {
    preloadRunIdRef.current++;
    pendingWorkflowRef.current = null;
    preloadSnapshotRef.current = null;
    setSpeakerSnippets([]);
    setSpeakerThumbnails([]);
    setSpeakerAssignedThumbnails({});
    setSpeakerFaceSlots({});
    setPrimaryFaceSlots([]);
    setFaceOptions([]);
    setSpeakerAssignments({});
    setAvailableFaceSlots(Array.from({ length: 6 }, (_, i) => i));
    setSpeakerQueue([]);
    setActiveSpeakerId(null);
    setHasPlayedSpeakerAudio(false);
    setIsSpeakerAudioPlaying(false);
    setIsSpeakerIdentificationActive(false);
    setHidePreloadThumbnails(false);
  }, []);

  const revokeSpeakerThumbnailUrls = (thumbnails: SpeakerFaceThumbnail[]) => {
    if (
      !thumbnails?.length ||
      typeof URL === "undefined" ||
      typeof URL.revokeObjectURL !== "function"
    )
      return;
    thumbnails.forEach((t) => {
      if (t.src?.startsWith("blob:")) URL.revokeObjectURL(t.src);
    });
  };

  const getTranscriptWordsSnapshot = (): TranscriptWord[] =>
    currentTranscriptWords;

  const formatToSRT = (words: TranscriptWord[], clipStart: number): string => {
    return words
      .filter((w) => w.start >= clipStart)
      .map((word, i) => {
        const s = Math.max(0, word.start - clipStart);
        const e = Math.max(s + 0.1, word.end - clipStart);
        const formatTime = (t: number) => {
          const ms = Math.floor((t % 1) * 1000);
          const secs = Math.floor(t % 60);
          const mins = Math.floor((t / 60) % 60);
          const hrs = Math.floor(t / 3600);
          return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
        };
        return `${i + 1}\n${formatTime(s)} --> ${formatTime(e)}\n${word.text}`;
      })
      .join("\n\n");
  };

  // Sync timeline segments with selected concept
  useEffect(() => {
    if (selectedConceptId) {
      const concept = conceptChoices.find((c) => c.id === selectedConceptId);
      if (concept) {
        // Prioritize explicit start_time/end_time from Gemini
        let start = concept.start_time ?? concept.trimmed_words[0]?.start ?? 0;
        let end =
          concept.end_time ??
          concept.trimmed_words[concept.trimmed_words.length - 1]?.end ??
          start + 60;

        // Final duration safety enforcement
        const actualDuration = end - start;
        if (refinementMode === "thirty_seconds" && actualDuration > 40) {
          end = start + 35;
        } else if (refinementMode === "sixty_seconds" && actualDuration > 75) {
          end = start + 65;
        }

        setTimelineSegments([
          {
            start,
            end,
            timelineStart: 0,
          },
        ]);

        // Auto-jump to the start of the clip
        setTimelinePosition(start);
        console.log(
          `[Timeline] Synced to concept "${concept.title}" (${start.toFixed(1)}s - ${end.toFixed(1)}s)`,
        );
      }
    } else {
      setTimelineSegments([]);
    }
  }, [selectedConceptId, conceptChoices, refinementMode]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
        setIsFaceApiLoaded(true);
        console.log("[Native Face-API] Models loaded successfully.");
      } catch (err) {
        console.error("[Native Face-API] Failed to load models:", err);
      }
    };
    loadModels();
  }, []);

  // Consolidated Native Helpers & Stubs
  const playSpeakerSnippet = (snippet: SpeakerSnippet) => {
    setTimelinePosition(snippet.start);
    setIsPlaying(true);
    setActiveSpeakerId(snippet.id);
  };

  const handleFaceSelection = (face: SpeakerFaceThumbnail) => {
    if (!activeSpeakerId) return;
    setSpeakerAssignments((prev) => ({
      ...prev,
      [activeSpeakerId]: face.slotIndex,
    }));
    setSpeakerAssignedThumbnails((prev) => ({
      ...prev,
      [activeSpeakerId]: face.src,
    }));
    console.log(
      `[Face Assignment] Speaker ${activeSpeakerId} mapped to face slot ${face.slotIndex}`,
    );
  };

  const togglePlayback = () => setIsPlaying(!isPlaying);
  const scrubToTime = (time: number) => setTimelinePosition(time);
  const applyCaptionVisibility = (enabled: boolean) => {
    setCaptionsEnabled(enabled);
  };
  const applyTextHookVisibility = (enabled: boolean) => {
    setTextHookEnabled(enabled);
  };
  const applyTextHook = (text: string, duration: number) => {
    setTextHookText(text);
  };
  const applySceneAspectRatio = (ratioId: string) => {
    setTargetAspectRatioId(ratioId);
  };
  const clearTemplateLayout = () => {
    setSpeakerTemplateId("none");
  };

  const calculateFaceFocalPoint = (
    faceBounds: FaceBounds | FaceBounds[],
  ): number => {
    if (Array.isArray(faceBounds)) {
      if (faceBounds.length === 0) return 0.5;
      const sum = faceBounds.reduce((acc, b) => acc + b.cx, 0);
      return sum / faceBounds.length;
    }
    return faceBounds.cx;
  };

  const applySoloFaceCropping = async () => {
    if (!activeSpeakerId || !speakerAssignments[activeSpeakerId]) return;
    const slot = speakerAssignments[activeSpeakerId];
    const faces = speakerFaceSlots[activeSpeakerId] || [];
    if (faces.length > 0) {
      const focalX = calculateFaceFocalPoint(faces[0]);
      setFocalPoints((prev) => ({ ...prev, [activeSpeakerId]: focalX }));
    }
  };

  const canApplySpeakerTemplate = () => {
    return Object.keys(speakerAssignments).length > 0;
  };

  const applySpeakerTemplate = async (id: SpeakerTemplateId) => {
    setSpeakerTemplateId(id);
    console.log(`[Template] Switched to ${id}`);
  };

  const buildSpeakerAssignments = () => speakerAssignments;
  const selectedConcept = conceptChoices.find(
    (c) => c.id === selectedConceptId,
  );

  const applyFaceAwareCropping = async () => {
    if (!isPlaying || !previewVideoRef.current || !isFaceApiLoaded) return;

    try {
      // Detect single face in the current frame
      const detection = await faceapi.detectSingleFace(
        previewVideoRef.current,
        new faceapi.TinyFaceDetectorOptions(),
      );

      if (detection) {
        const videoElement = previewVideoRef.current;
        const faceCenterX =
          (detection.box.x + detection.box.width / 2) / videoElement.videoWidth;

        // If we have an active speaker, update their focal point with smoothing (Lerp)
        if (activeSpeakerId) {
          setFocalPoints((prev) => {
            const currentFocal = prev[activeSpeakerId] ?? 0.5;
            // Smooth adjustment (20% new, 80% old)
            const smoothedFocal = currentFocal * 0.8 + faceCenterX * 0.2;
            return { ...prev, [activeSpeakerId]: smoothedFocal };
          });
        }
      }
    } catch (err) {
      // Fail silently for frame detection issues
    }
  };

  // Tracking Effect: Run detection while playing in 9:16 mode
  useEffect(() => {
    let frameId: number;
    const loop = async () => {
      if (isPlaying && targetAspectRatioId === "9:16") {
        await applyFaceAwareCropping();
        frameId = requestAnimationFrame(loop);
      }
    };
    if (isPlaying) {
      frameId = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, targetAspectRatioId, activeSpeakerId, isFaceApiLoaded]);

  const updateTextHookLayout = (text: string) => {
    setTextHookText(text);
  };
  const handleExportPreloadScript = () => {};
  const handleAspectRatioChange = (ratioId: string) => {
    setTargetAspectRatioId(ratioId);
    applySceneAspectRatio(ratioId);
  };
  const handleUploadClick = () => fileInputRef.current?.click();
  const handleUploadKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") handleUploadClick();
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setTimelineSegments([]);
      setTimelineDuration(0);
      setTimelinePosition(0);
      setCurrentTranscriptWords([]);
      resetWorkflowState();
    }
  };
  const handleUploadDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDropActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileChange({ target: { files: [file] } } as any);
  };
  const handleRemoveVideo = useCallback(() => {
    setVideoFile(null);
    resetWorkflowState();
    resetPreloadState();
    setTimelineDuration(0);
    setTimelinePosition(0);
    setIsPlaying(false);
    setTimelineSegments([]);
  }, [resetWorkflowState, resetPreloadState]);

  const handleExport = async () => {
    if (isExporting || !videoFile) return;
    setIsExporting(true);
    setExportError(null);
    setProgress(0);
    try {
      const ffmpeg = await loadFFmpeg();
      const inputName =
        "input" + videoFile.name.substring(videoFile.name.lastIndexOf("."));
      const outputName = "export.mp4";

      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));

      // Load a font for captions
      try {
        const fontUrl =
          "https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Bold.ttf";
        await ffmpeg.writeFile("font.ttf", await fetchFile(fontUrl));
      } catch (fontErr) {
        console.warn(
          "Failed to load custom font, attempting default fallback",
          fontErr,
        );
      }

      const activeClips = timelineSegments;
      if (!activeClips.length) throw new Error("No clips selected for export.");
      const clip = activeClips[0];

      // Build filter chain
      const filters: string[] = [];

      if (sourceVideoSize) {
        const targetRatio = resolveAspectRatio(targetAspectRatioId);
        const sourceRatio = sourceVideoSize.width / sourceVideoSize.height;

        if (Math.abs(targetRatio - sourceRatio) > 0.01) {
          // We need to crop
          let cropW = sourceVideoSize.width;
          let cropH = sourceVideoSize.height;

          if (targetRatio < sourceRatio) {
            // Target is narrower (e.g. 9:16 from 16:9)
            cropW = Math.floor(sourceVideoSize.height * targetRatio);
          } else {
            // Target is wider (e.g. 16:9 from 4:3) - though rare for this app
            cropH = Math.floor(sourceVideoSize.width / targetRatio);
          }

          // Ensure even dimensions
          const evenW = cropW % 2 === 0 ? cropW : cropW - 1;
          const evenH = cropH % 2 === 0 ? cropH : cropH - 1;

          // SMART SPEAKER TRACKING: Determine X Offset based on active speaker
          const speakerAssignments = buildSpeakerAssignments();
          const hasAssignments = Object.keys(speakerAssignments).length > 0;

          if (hasAssignments && targetAspectRatioId === "9:16") {
            // We'll create a complex filter that shifts the crop x-offset based on who is speaking
            // For now, we'll use a simpler approach: find the dominant speaker or center on the active one
            // To do this perfectly in FFmpeg, we'd need a long 'expr' for crop 'x'.
            // For simplicity in this implementation, we'll center on the first assigned speaker's focal point
            // OR use a safe center if no mapping exists for a segment.

            const firstSpeakerId = Object.keys(speakerAssignments)[0];
            const faces = speakerFaceSlots[firstSpeakerId] || [];
            const focalX = faces.length > 0 ? faces[0].cx : 0.5;

            const xOffset = Math.max(
              0,
              Math.min(
                sourceVideoSize.width - evenW,
                Math.floor(focalX * sourceVideoSize.width - evenW / 2),
              ),
            );
            filters.push(`crop=${evenW}:${evenH}:${xOffset}:(ih-oh)/2`);
          } else {
            const xOffset = Math.max(
              0,
              Math.floor((sourceVideoSize.width - evenW) / 2),
            );
            const yOffset = Math.max(
              0,
              Math.floor((sourceVideoSize.height - evenH) / 2),
            );
            filters.push(`crop=${evenW}:${evenH}:${xOffset}:${yOffset}`);
          }
        } else {
          // Just ensure even dimensions
          filters.push(`scale=ceil(iw/2)*2:ceil(ih/2)*2`);
        }
      }

      if (captionsEnabled) {
        const clipWords = currentTranscriptWords.filter(
          (w) => w.end > clip.start && w.start < clip.end,
        );

        // Build caption blocks using shared utility
        const blocks = groupWordsIntoCaptions(clipWords);

        const clipCaptions = blocks
          .map((block) => {
            const safeText = block.text.replace(/'/g, "’").replace(/:/g, "\\:");
            const relStart = Math.max(0, block.start - clip.start);
            const relEnd = Math.max(
              relStart + 0.1,
              block.start + block.duration - clip.start - 0.01,
            );
            // Reduced font sizes (20/26) and lower placement (h-120) as per user request
            const fontSize = targetAspectRatioId === "9:16" ? 20 : 26;
            return `drawtext=fontfile=font.ttf:text='${safeText}':fontsize=${fontSize}:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-120:line_spacing=10:enable='between(t,${relStart.toFixed(2)},${relEnd.toFixed(2)})'`;
          })
          .join(",");

        if (clipCaptions) {
          filters.push(clipCaptions);
        }
      }

      const vf = filters.length > 0 ? filters.join(",") : null;

      // OPTIMIZED SEEKING: -ss before -i for speed, -t after for duration.
      // This resets 't' in the filtergraph to 0 at the start of the output.
      const args = [
        "-ss",
        clip.start.toString(),
        "-t",
        (clip.end - clip.start).toString(),
        "-i",
        inputName,
      ];

      if (vf) {
        args.push("-vf", vf);
      }

      // Add encoding params - ensured even dimensions for H.264
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-avoid_negative_ts",
        "make_zero",
        outputName,
      );

      ffmpeg.on("log", ({ message }) => {
        console.log(`[FFmpeg Log] ${message}`);
      });

      console.log("[Export] Running FFmpeg command:", args.join(" "));
      const exitCode = await ffmpeg.exec(args);

      if (exitCode !== 0) {
        throw new Error(
          `FFmpeg export failed with exit code ${exitCode}. Check browser console for detailed logs.`,
        );
      }

      const data = await ffmpeg.readFile(outputName);
      if (!data || (data as Uint8Array).length === 0) {
        throw new Error(
          "Exported file is empty (0 bytes). View browser console for details.",
        );
      }

      const blob = new Blob([data as any], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${videoFile.name.replace(/\.[^/.]+$/, "")}-clip.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export failed", error);
      setExportError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setIsExporting(false);
      setProgress(0);
    }
  };

  const mapTrimmedWordsToSource = (
    source: TranscriptWord[],
    trimmed: TranscriptWord[],
  ): TranscriptWord[] => {
    if (!trimmed.length) return [];
    const start = trimmed[0].start;
    const end = trimmed[trimmed.length - 1].end;
    return source.filter((w) => w.start >= start && w.end <= end);
  };

  const mapTrimmedWordsToSourceOrFallback = (source: any[], trimmed: any[]) =>
    mapTrimmedWordsToSource(source, trimmed);

  const resolveSpeakerLabel = (speakerId: string, fallbackIndex?: number) => {
    const match = speakerSnippets.find((s) => s.id === speakerId);
    if (match?.label) return match.label;
    if (speakerId && speakerId !== "unknown") return `Speaker ${speakerId}`;
    return typeof fallbackIndex === "number"
      ? `Speaker ${fallbackIndex + 1}`
      : "Unknown speaker";
  };

  const resolveSpeakerThumbnail = (
    speakerId: string,
  ): SpeakerFaceThumbnail | null => {
    const assigned = speakerAssignedThumbnails[speakerId];
    if (assigned) {
      return {
        id: `assigned-${speakerId}`,
        speakerId,
        speakerLabel: "",
        start: 0,
        end: 0,
        slotIndex: -1,
        bounds: { cx: 0.5, cy: 0.5, x0: 0, x1: 1, y0: 0, y1: 1 },
        src: assigned,
      };
    }
    const assignedSlot = speakerAssignments[speakerId];
    if (typeof assignedSlot === "number" && Number.isFinite(assignedSlot)) {
      return (
        speakerThumbnails.find(
          (t) => t.speakerId === speakerId && t.slotIndex === assignedSlot,
        ) ??
        speakerThumbnails.find((t) => t.speakerId === speakerId) ??
        null
      );
    }
    return speakerThumbnails.find((t) => t.speakerId === speakerId) ?? null;
  };

  const getSpeakerPreviewThumbnails = (speakerId: string) => {
    const thumb = resolveSpeakerThumbnail(speakerId);
    return thumb ? [thumb] : [];
  };

  const buildSpeakerPreviews = (words: TranscriptWord[]): SpeakerPreview[] => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    words.forEach((w) => {
      const id = w.speaker_id ?? "unknown";
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    });
    return ordered.map((id, idx) => ({
      id,
      label: resolveSpeakerLabel(id, idx),
      thumbnails: getSpeakerPreviewThumbnails(id),
    }));
  };

  const conceptSpeakerPreviews: Record<string, SpeakerPreview[]> = {};
  conceptChoices.forEach((c) => {
    const resolved = mapTrimmedWordsToSourceOrFallback(
      currentTranscriptWords,
      c.trimmed_words ?? [],
    );
    conceptSpeakerPreviews[c.id] = buildSpeakerPreviews(resolved);
  });

  const activeSpeakerPreview = (() => {
    if (!videoFile || !timelineSegments.length) return null;
    const clip =
      timelineSegments.find(
        (s) => timelinePosition >= s.start && timelinePosition <= s.end,
      ) || timelineSegments[0];
    const speakerId = "1"; // Simplified for native
    return {
      id: speakerId,
      label: resolveSpeakerLabel(speakerId),
      thumbnail: resolveSpeakerThumbnail(speakerId),
    };
  })();

  // Derived UI State
  const hasVideo = Boolean(videoFile);
  const areLoadingStepsComplete =
    autoProcessStatuses.audio === "complete" &&
    autoProcessStatuses.transcript === "complete" &&
    autoProcessStatuses.analysis === "complete";
  const isFaceDetectionActive =
    areLoadingStepsComplete &&
    (autoProcessStatuses.preload === "active" || isSpeakerIdentificationActive);
  const isWorkflowProcessing =
    autoProcessing ||
    isExtracting ||
    isTranscribing ||
    isSpeakerIdentificationActive;
  const showTrimStage =
    hasVideo && (!hasStartedWorkflow || !!autoProcessingError);
  const showProcessingStage =
    hasVideo && hasStartedWorkflow && isWorkflowProcessing;
  const showFaceDetectionInCard = isFaceDetectionActive;
  const showResultStage =
    hasVideo &&
    hasStartedWorkflow &&
    !isWorkflowProcessing &&
    !autoProcessingError;
  const showUploadStage = !hasVideo;
  const showSetupStage = !showProcessingStage && !showResultStage;
  const showInlinePreview = showSetupStage;
  const showFullPreview = showResultStage;
  const isPortraitResult = showResultStage && targetAspectRatioId === "9:16";
  const sourceAspectRatio = sourceVideoSize
    ? sourceVideoSize.width / sourceVideoSize.height
    : DEFAULT_ASPECT_RATIO;
  const previewAspectRatio = showResultStage
    ? resolveAspectRatio(targetAspectRatioId)
    : sourceAspectRatio;

  const currentFocalPointX = (() => {
    if (!videoFile || targetAspectRatioId !== "9:16") return 0.5;

    // Find the speaker at the current timeline position
    const currentWord = currentTranscriptWords.find(
      (w) => timelinePosition >= w.start && timelinePosition <= w.end,
    );
    const currentSpeakerId = currentWord?.speaker_id || "1";

    // Use the dynamic tracked focal point if available
    if (typeof focalPoints[currentSpeakerId] === "number") {
      return focalPoints[currentSpeakerId];
    }

    // Fallback to static assigned slot
    const assignedSlot = speakerAssignments[currentSpeakerId];
    if (typeof assignedSlot !== "undefined") {
      const speakerFaces = speakerFaceSlots[currentSpeakerId] || [];
      if (speakerFaces.length > 0) {
        return speakerFaces[0].cx;
      }
    }
    return 0.5;
  })();

  // Keep activeSpeakerId in sync during playback for tracking loop
  useEffect(() => {
    if (!isPlaying) return;
    const currentWord = currentTranscriptWords.find(
      (w) => timelinePosition >= w.start && timelinePosition <= w.end,
    );
    const currentSpeakerId = currentWord?.speaker_id || "1";
    if (currentSpeakerId !== activeSpeakerId) {
      setActiveSpeakerId(currentSpeakerId);
    }
  }, [timelinePosition, isPlaying, currentTranscriptWords, activeSpeakerId]);

  const activeSpeakerSnippet =
    activeSpeakerId &&
    speakerSnippets.find((snippet) => snippet.id === activeSpeakerId);
  const availableOptions = faceOptions.filter((option) =>
    availableFaceSlots.includes(option.slotIndex),
  );
  const assignedFaceSlots = Object.values(speakerAssignments).filter(
    (slot) => typeof slot === "number" && Number.isFinite(slot),
  );
  const uniqueAssignedSlots = new Set(assignedFaceSlots);
  const canShowTemplate = showResultStage && uniqueAssignedSlots.size >= 1;
  const availableTemplateOptions = SPEAKER_TEMPLATE_OPTIONS.filter((option) => {
    if (option.id === "none") return true;
    if (option.id === "solo") return uniqueAssignedSlots.size >= 1;
    return uniqueAssignedSlots.size >= 2;
  });

  const shouldShowOverlayControls = showFullPreview && isPlaying;

  useEffect(() => {
    applyCaptionVisibility(captionsEnabled);
  }, [applyCaptionVisibility, captionsEnabled]);

  useEffect(() => {
    applyTextHookVisibility(textHookEnabled);
    if (textHookEnabled && textHookTextRef.current) {
      applyTextHook(textHookTextRef.current, textHookDurationRef.current);
    }
  }, [applyTextHook, applyTextHookVisibility, textHookEnabled]);

  const runAutomaticWorkflow = async () => {
    if (!videoFile || autoProcessing) return;
    beginWorkflow();
    try {
      updateProcessingStatus("audio", "active");
      const ffmpeg = await loadFFmpeg();
      const inputName =
        "audio_input" +
        videoFile.name.substring(videoFile.name.lastIndexOf("."));
      const audioOutput = "output.mp3";
      await ffmpeg.writeFile(inputName, await fetchFile(videoFile));
      await ffmpeg.exec([
        "-i",
        inputName,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-ar",
        "44100",
        "-ac",
        "2",
        audioOutput,
      ]);
      const audioData = await ffmpeg.readFile(audioOutput);
      const audioBlob = new Blob([audioData as any], { type: "audio/mp3" });
      updateProcessingStatus("audio", "complete");

      updateProcessingStatus("transcript", "active");
      const transcript = await transcribeWithDeepgram(audioBlob);
      const words = extractDeepgramTranscriptWords(transcript);
      setCurrentTranscriptWords(words);
      updateProcessingStatus("transcript", "complete");

      updateProcessingStatus("analysis", "active");

      let conceptChoices;

      if (refinementMode === "disfluency") {
        const smartResult = await requestSmartCuts(words);
        setGeminiDebug(smartResult.trimmed_text);
        conceptChoices = [
          {
            id: "smart-cuts",
            title: "Smart Cuts",
            description: "Full cleaned transcript with filler words removed",
            trimmed_words: smartResult.trimmed_words,
            notes: smartResult.notes,
            hook: null,
            estimated_duration_seconds: null,
            start_time: smartResult.trimmed_words[0]?.start ?? 0,
            end_time:
              smartResult.trimmed_words[smartResult.trimmed_words.length - 1]
                ?.end ?? 0,
          } as GeminiConceptChoice,
        ];
      } else {
        const refinement = await requestGeminiRefinement(words, refinementMode);
        setGeminiDebug(refinement.rawText);
        conceptChoices = refinement.refinement.concepts.filter(
          (c) => c.trimmed_words.length > 0,
        );
      }

      const validConcepts = (conceptChoices as any[]).filter(
        (c: any) => c.trimmed_words?.length > 0,
      );
      setConceptChoices(validConcepts);
      updateProcessingStatus("analysis", "complete");

      if (validConcepts.length > 0) {
        setSelectedConceptId(validConcepts[0].id);
      } else {
        console.warn(
          "[Workflow] Gemini returned zero valid concepts. Attempting Multi-Clip High-Density Search.",
        );
        // INTELLIGENT MULTI-CLIP FALLBACK: Zone-based peak search (Intro, Body, Outro)
        const fallbackConcepts: any[] = [];

        const totalDuration = words[words.length - 1]?.end ?? 0;
        const zones = [
          { name: "Intro", start: 0, end: 0.33, window: 30 },
          { name: "Core Segment", start: 0.35, end: 0.65, window: 45 },
          { name: "Key Takeaway", start: 0.7, end: 1.0, window: 60 },
        ];

        zones.forEach((zone, idx) => {
          let bestStartIdx = -1;
          let maxWordCount = 0;
          const zoneStart = totalDuration * zone.start;
          const zoneEnd = totalDuration * zone.end;

          // Slide window within the zone
          for (let i = 0; i < words.length; i++) {
            const startTime = words[i].start;
            if (startTime < zoneStart) continue;
            if (startTime > zoneEnd - zone.window) break;

            const endTime = startTime + zone.window;
            const wordsInWindow = words.filter(
              (w) => w.start >= startTime && w.end <= endTime,
            ).length;

            if (wordsInWindow > maxWordCount) {
              maxWordCount = wordsInWindow;
              bestStartIdx = i;
            }
          }

          if (bestStartIdx !== -1) {
            const fallbackStart = words[bestStartIdx].start;
            const fallbackEnd =
              words.find((w) => w.start >= fallbackStart + zone.window)?.end ??
              Math.min(fallbackStart + zone.window, totalDuration);
            const fallbackWords = words.filter(
              (w) => w.start >= fallbackStart && w.end <= fallbackEnd,
            );

            fallbackConcepts.push({
              id: `zone-${idx}`,
              title: `${zone.name} (${zone.window}s)`,
              description: `A high-impact ${zone.name} segment captured from the video's ${idx === 0 ? "beginning" : idx === 1 ? "middle" : "final"} section.`,
              trimmed_words: fallbackWords,
              start_time: fallbackStart,
              end_time: fallbackEnd,
            });
          }
        });

        if (fallbackConcepts.length > 0) {
          setConceptChoices(fallbackConcepts);
          setSelectedConceptId(fallbackConcepts[0].id);
        } else {
          // Absolute last resort: First 30 seconds
          const absoluteFallback = {
            id: "fallback-base",
            title: "Standard Clip",
            description: "Default fallback clip from start of video.",
            trimmed_words: words.slice(0, 50),
            start_time: words[0]?.start ?? 0,
            end_time: words[Math.min(words.length - 1, 50)]?.end ?? 30,
          };
          setConceptChoices([absoluteFallback as any]);
          setSelectedConceptId(absoluteFallback.id);
        }
      }
    } catch (error) {
      console.error("Workflow failed", error);
      setAutoProcessingError(
        error instanceof Error ? error.message : "Workflow failed.",
      );
    } finally {
      setAutoProcessing(false);
    }
  };

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center">
        {!isEmbed && <AppHeader />}

        <main
          className={`w-full max-w-6xl flex-grow flex flex-col gap-8 p-4 md:p-8 ${isEmbed ? "mt-0" : ""}`}
        >
          {isEmbed && (
            <div className="flex items-center justify-center gap-4 mb-10">
              <div className="overflow-hidden w-16 h-16 flex items-center justify-center">
                <img
                  src="/logo.png"
                  className="w-full h-full object-contain"
                  alt="NovaClipperAI Logo"
                />
              </div>
              <h1 className="text-2xl md:text-4xl font-black tracking-tight bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                NovaClipperAI
              </h1>
            </div>
          )}
          {showUploadStage && (
            <div
              className={`relative group border-2 border-dashed rounded-[2.5rem] p-8 md:p-20 text-center transition-all duration-500 overflow-hidden ${
                isDropActive
                  ? "border-primary bg-primary/5 scale-[1.02] shadow-2xl shadow-primary/10"
                  : "border-muted-foreground/20 bg-card shadow-sm hover:shadow-md hover:border-primary/30"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDropActive(true);
              }}
              onDragLeave={() => setIsDropActive(false)}
              onDrop={handleUploadDrop}
            >
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors" />
              <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-secondary/5 rounded-full blur-3xl group-hover:bg-secondary/10 transition-colors" />

              <div className="relative z-10">
                <div className="bg-gradient-to-br from-primary to-secondary w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-primary/30 transform group-hover:rotate-6 transition-transform">
                  <Upload className="w-12 h-12 text-white" />
                </div>
                <h1 className="text-4xl md:text-5xl font-black mb-6 tracking-tight text-foreground animate-in fade-in slide-in-from-bottom-5 duration-1000 fill-mode-forwards">
                  Turn long videos into{" "}
                  <span className="text-primary italic">viral</span> gold
                </h1>
                <p className="text-muted-foreground/80 dark:text-foreground/60 text-lg md:text-xl font-medium mb-12 max-w-2xl mx-auto leading-relaxed animate-in fade-in slide-in-from-bottom-5 duration-1000 delay-300">
                  Upload your video and let our AI extract the most engaging
                  moments for TikTok, Reels, and Shorts in seconds.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Button
                    size="lg"
                    className="rounded-full px-12 py-7 text-xl h-auto font-bold shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
                    onClick={handleUploadClick}
                  >
                    Choose File
                  </Button>
                  <p className="text-sm text-muted-foreground font-medium">
                    or drag and drop here
                  </p>
                </div>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="video/*"
                onChange={handleFileChange}
              />
            </div>
          )}

          {showTrimStage && videoFile && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-card rounded-3xl overflow-hidden border shadow-xl aspect-video relative group">
                  <PreviewCanvas
                    videoFile={videoFile}
                    position={timelinePosition}
                    onPositionChange={setTimelinePosition}
                    onDurationLoad={setTimelineDuration}
                    onVideoLoad={(w, h) =>
                      setSourceVideoSize({ width: w, height: h })
                    }
                    aspectRatio={resolveAspectRatio(targetAspectRatioId)}
                    captions={[]}
                    isPlaying={isPlaying}
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-20 h-20 rounded-full bg-primary/20 backdrop-blur-md text-white border-white/30 border pointer-events-auto shadow-2xl"
                      onClick={togglePlayback}
                    >
                      {isPlaying ? (
                        <Pause className="w-10 h-10 fill-current" />
                      ) : (
                        <Play className="w-10 h-10 fill-current ml-2" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="bg-card rounded-3xl p-6 border shadow-lg space-y-6">
                  <TimelineScrubber
                    duration={timelineDuration}
                    position={timelinePosition}
                    onPositionChange={setTimelinePosition}
                    isPlaying={isPlaying}
                    onTogglePlayback={togglePlayback}
                  />
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-full w-12 h-12 flex-shrink-0"
                        onClick={handleRemoveVideo}
                      >
                        <Trash2 className="w-5 h-5 text-destructive" />
                      </Button>
                      <div className="text-sm font-medium bg-muted px-4 py-2 rounded-full border flex-grow text-center">
                        {Math.floor(timelinePosition / 60)}:
                        {(timelinePosition % 60).toFixed(0).padStart(2, "0")} /{" "}
                        {Math.floor(timelineDuration / 60)}:
                        {(timelineDuration % 60).toFixed(0).padStart(2, "0")}
                      </div>
                    </div>
                    <Button
                      size="lg"
                      className="rounded-full px-8 py-6 sm:py-2 gap-2 shadow-lg shadow-primary/20 w-full sm:w-auto text-lg sm:text-base font-bold"
                      onClick={runAutomaticWorkflow}
                    >
                      <Sparkles className="w-5 h-5" />
                      Magic Shorten
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-card rounded-3xl p-8 border shadow-lg space-y-6">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <Settings className="w-5 h-5 text-primary" />
                    Automation
                  </h3>
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Our advanced AI will analyze your footage, remove silence,
                      and generate viral-worthy clips with captions.
                    </p>
                    <RefinementPicker
                      value={refinementMode}
                      onChange={setRefinementMode}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {showProcessingStage && (
            <div className="max-w-2xl mx-auto w-full">
              <ProcessingStatusCard
                statuses={autoProcessStatuses}
                progress={0}
                autoProcessingError={autoProcessingError}
              />
            </div>
          )}

          {showResultStage && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-5 lg:sticky lg:top-8 z-20">
                <div
                  className={`bg-card rounded-[2.5rem] overflow-hidden border-8 border-card shadow-2xl relative ${isPortraitResult ? "aspect-[9/16]" : "aspect-video"}`}
                >
                  <PreviewCanvas
                    ref={previewVideoRef}
                    videoFile={videoFile}
                    isPlaying={isPlaying}
                    position={timelinePosition}
                    onPositionChange={setTimelinePosition}
                    onDurationLoad={setTimelineDuration}
                    aspectRatio={previewAspectRatio}
                    focalPointX={currentFocalPointX}
                    className="w-full h-full object-cover"
                    captions={
                      captionsEnabled && selectedConcept
                        ? groupWordsIntoCaptions(selectedConcept.trimmed_words)
                        : []
                    }
                  />

                  {shouldShowOverlayControls && (
                    <div className="absolute inset-0 flex flex-col justify-between p-8 pointer-events-none">
                      <div className="w-full flex justify-end">
                        <div className="bg-primary/20 backdrop-blur-md rounded-2xl p-4 border border-white/20 text-white animate-in fade-in slide-in-from-top-4 shadow-xl">
                          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70 mb-1">
                            Active Speaker
                          </h4>
                          <p className="font-bold text-lg leading-tight">
                            {resolveSpeakerLabel(activeSpeakerId || "1")}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="icon"
                      className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-xl border-white/20 text-white hover:bg-white/20"
                      onClick={togglePlayback}
                    >
                      {isPlaying ? (
                        <Pause className="w-6 h-6 fill-current" />
                      ) : (
                        <Play className="w-6 h-6 fill-current ml-1" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 space-y-8">
                <div className="bg-card rounded-3xl p-8 border shadow-lg space-y-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b">
                    <div>
                      <h2 className="text-2xl md:text-4xl font-black tracking-tight text-slate-900">
                        Clip Factory
                      </h2>
                      <p className="text-muted-foreground mt-1 text-base md:text-lg">
                        Refine and export your viral masterpieces
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <Button
                        variant="outline"
                        size="lg"
                        className="rounded-full px-6 border-2 hover:bg-muted font-bold w-full sm:w-auto"
                        onClick={resetWorkflowState}
                      >
                        Reset
                      </Button>
                      <Button
                        size="lg"
                        className="rounded-full px-8 gap-2 shadow-2xl shadow-primary/30 font-bold bg-gradient-to-r from-primary to-secondary border-0 transition-all hover:scale-105 w-full sm:w-auto"
                        onClick={handleExport}
                        disabled={isExporting}
                      >
                        {isExporting ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Download className="w-5 h-5" />
                        )}
                        {isExporting ? "Cooking..." : "Export Video"}
                      </Button>
                    </div>
                  </div>

                  <div className="h-auto lg:h-[650px] px-2 md:px-6 py-4 overflow-y-auto custom-scrollbar">
                    <div className="space-y-8">
                      <section className="space-y-4">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="p-2 bg-primary/10 rounded-xl">
                            <Scissors className="w-5 h-5 text-primary" />
                          </div>
                          <h3 className="text-xl font-bold">
                            Detected Highlights
                          </h3>
                        </div>
                        <ResultView
                          concepts={conceptChoices}
                          selectedConceptId={selectedConceptId}
                          onSelectConcept={setSelectedConceptId}
                          speakerPreviews={conceptSpeakerPreviews}
                        />
                      </section>

                      <section className="space-y-4 border-t pt-8">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="p-2 bg-primary/10 rounded-xl">
                            <Maximize2 className="w-5 h-5 text-primary" />
                          </div>
                          <h3 className="text-xl font-bold">Canvas Settings</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                            <label className="text-sm font-semibold text-muted-foreground">
                              ASPECT RATIO
                            </label>
                            <AspectRatioPicker
                              options={ASPECT_RATIO_OPTIONS}
                              value={targetAspectRatioId}
                              onChange={handleAspectRatioChange}
                            />
                          </div>
                          <div className="space-y-3">
                            <label className="text-sm font-semibold text-muted-foreground">
                              SPEAKER FOCUS
                            </label>
                            <TemplatePicker
                              options={availableTemplateOptions}
                              value={speakerTemplateId}
                              onChange={setSpeakerTemplateId}
                              disabled={!canShowTemplate}
                            />
                          </div>
                        </div>
                      </section>

                      {showFaceDetectionInCard && (
                        <section className="space-y-4 border-t pt-8">
                          <h3 className="font-bold flex items-center gap-2">
                            <Maximize2 className="w-4 h-4" />
                            Face Center Identification
                          </h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            Matching speakers to face locations for precise
                            cropping.
                          </p>
                          <FaceAssignmentCard
                            hideThumbnails={hidePreloadThumbnails}
                            onSelectFace={handleFaceSelection}
                            faceOptions={faceOptions}
                            availableFaceSlots={availableFaceSlots}
                            speakerAssignments={speakerAssignments}
                          />
                        </section>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-primary/5 border border-primary/20 rounded-3xl p-6 flex items-start gap-4">
                  <div className="p-3 bg-primary/10 rounded-2xl">
                    <AlertCircle className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-lg mb-1">
                      AI Live Tracking [v2]
                    </h4>
                    <p className="text-muted-foreground leading-relaxed">
                      Our <b>Dynamic Face-Following</b> is now active. The 9:16
                      window will automatically glide to follow the speaker's
                      face as they move.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {!isEmbed && (
          <footer className="mt-12 py-12 border-t w-full max-w-6xl text-center space-y-4">
            <p className="text-muted-foreground font-medium">
              Built for creators. Powered by Browser-Native AI.
            </p>
            <p className="text-muted-foreground/60 text-sm font-bold tracking-tight">
              Designed and developed by{" "}
              <a
                href="https://samuelolubukun.netlify.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 transition-colors font-black underline decoration-primary/30 underline-offset-8"
              >
                Samuel Olubukun
              </a>
            </p>
          </footer>
        )}

        {isDebugOpen && (
          <DebugModal
            isOpen={true}
            onClose={() => setIsDebugOpen(false)}
            transcript={
              transcriptDebug ? JSON.stringify(transcriptDebug, null, 2) : null
            }
            gemini={geminiDebug}
            geminiFaceBoxes={geminiFaceDebug}
            geminiFaceThumbnail={geminiFaceThumbnail}
            captions={
              captionDebug ? JSON.stringify(captionDebug, null, 2) : null
            }
            debugExportMetrics={debugExportMetrics}
            preloadScript={null}
          />
        )}
      </div>
    </ThemeProvider>
  );
}
