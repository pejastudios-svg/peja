"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Video, Square, RotateCcw, X, Check, AlertCircle, RefreshCw } from "lucide-react";

interface VideoRecorderProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  maxDurationSec?: number;
  maxSizeMB?: number;
}

const DEFAULT_MAX_DURATION = 90;
const DEFAULT_MAX_SIZE_MB = 100;

function pickMimeType(): string {
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}`;
}

export function VideoRecorder({
  isOpen,
  onClose,
  onCapture,
  maxDurationSec = DEFAULT_MAX_DURATION,
  maxSizeMB = DEFAULT_MAX_SIZE_MB,
}: VideoRecorderProps) {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const mimeRef = useRef("");

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
    }
  }, []);

  const pauseStreamPreview = useCallback(() => {
    // Pause the live-camera <video> element but KEEP the MediaStream
    // alive so the user can retake without re-requesting permissions.
    if (videoElRef.current) {
      try { videoElRef.current.pause(); } catch {}
    }
  }, []);

  const startCamera = useCallback(
    async (mode: "user" | "environment") => {
      setError(null);
      setInitializing(true);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera not supported on this device");
        }
        stopStream();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode } },
          audio: true,
        });
        streamRef.current = stream;
        if (videoElRef.current) {
          videoElRef.current.srcObject = stream;
          videoElRef.current.muted = true;
          videoElRef.current.playsInline = true;
          await videoElRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
          setError("Camera and microphone permission denied");
        } else if (e.name === "NotFoundError") {
          setError("No camera found");
        } else if (e.name === "NotReadableError") {
          setError("Camera is in use by another app");
        } else {
          setError(e.message || "Could not access camera");
        }
      } finally {
        setInitializing(false);
      }
    },
    [stopStream]
  );

  // Boot camera when opened; tear down on close/unmount
  useEffect(() => {
    if (!isOpen) return;
    startCamera(facingMode);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch {}
      }
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Revoke preview URL when it changes or component closes
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Re-bind the live MediaStream to the video element whenever we swap
  // back from the recorded preview (e.g., after Retake). Required because
  // the live <video> is unmounted while the preview is shown.
  useEffect(() => {
    if (previewUrl || recordedBlob) return;
    const el = videoElRef.current;
    const stream = streamRef.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.muted = true;
      el.play().catch(() => {});
    }
  }, [previewUrl, recordedBlob]);

  const handleFlip = async () => {
    if (isRecording) return;
    const next = facingMode === "user" ? "environment" : "user";
    setFacingMode(next);
    await startCamera(next);
  };

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.requestData(); } catch {}
      try { rec.stop(); } catch {}
    }
    setIsRecording(false);
    pauseStreamPreview();
  }, [pauseStreamPreview]);

  const startRecording = () => {
    if (!streamRef.current) {
      setError("Camera not ready");
      return;
    }
    setError(null);
    setRecordedBlob(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    chunksRef.current = [];
    bytesRef.current = 0;
    setSizeBytes(0);
    setDuration(0);

    const mime = pickMimeType();
    mimeRef.current = mime;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
    } catch {
      setError("Recording not supported on this device");
      return;
    }
    recorderRef.current = recorder;

    const onData = (e: BlobEvent) => {
      if (!e.data || e.data.size === 0) return;
      chunksRef.current.push(e.data);
      bytesRef.current += e.data.size;
      setSizeBytes(bytesRef.current);
      if (bytesRef.current >= maxSizeBytes) {
        stopRecording();
      }
    };

    const finalize = () => {
      const type = recorder.mimeType || mime || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size === 0) {
        setError("Recording was empty — try again");
        return;
      }
      const url = URL.createObjectURL(blob);
      setRecordedBlob(blob);
      setPreviewUrl(url);
    };

    const onStop = () => {
      // Give the browser one microtask to deliver any trailing dataavailable
      setTimeout(finalize, 0);
    };

    const onError = () => {
      setError("Recording failed");
      stopRecording();
    };

    recorder.addEventListener("dataavailable", onData);
    recorder.addEventListener("stop", onStop);
    recorder.addEventListener("error", onError);

    // Timeslice of 1000ms — delivers chunks every second; required on
    // some WebKit/WebView builds to receive any data at all.
    recorder.start(1000);
    startedAtRef.current = Date.now();
    setIsRecording(true);

    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setDuration(elapsed);
      if (elapsed >= maxDurationSec) {
        stopRecording();
      }
    }, 250);
  };

  const handleRetake = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setRecordedBlob(null);
    setDuration(0);
    setSizeBytes(0);
    // Live stream rebinds to the video element via useEffect above.
  };

  const handleUse = () => {
    if (!recordedBlob) return;
    const type = recordedBlob.type.toLowerCase();
    const ext = type.includes("mp4") ? "mp4" : type.includes("webm") ? "webm" : "mp4";
    const file = new File([recordedBlob], `peja-${Date.now()}.${ext}`, { type: recordedBlob.type });
    onCapture(file);
    setRecordedBlob(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    onClose();
  };

  const handleClose = () => {
    if (isRecording) stopRecording();
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setRecordedBlob(null);
    setDuration(0);
    setSizeBytes(0);
    stopStream();
    onClose();
  };

  if (!isOpen) return null;

  const durationPct = Math.min(100, (duration / maxDurationSec) * 100);
  const sizePct = Math.min(100, (sizeBytes / maxSizeBytes) * 100);
  const nearingLimit = durationPct > 90 || sizePct > 90;

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 pt-4 pb-3">
        <button
          onClick={handleClose}
          className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
        >
          <X className="w-5 h-5 text-white" />
        </button>
        {!recordedBlob && (
          <button
            onClick={handleFlip}
            disabled={isRecording || initializing}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
          >
            <RotateCcw className="w-5 h-5 text-white" />
          </button>
        )}
      </div>

      {/* Preview area */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        {previewUrl ? (
          <video
            src={previewUrl}
            className="w-full h-full object-contain"
            controls
            playsInline
            autoPlay
          />
        ) : (
          <video
            ref={videoElRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            autoPlay
            style={{ transform: facingMode === "user" ? "scaleX(-1)" : "none" }}
          />
        )}

        {/* Floating REC indicator (top) */}
        {isRecording && !recordedBlob && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/90 backdrop-blur-md">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-xs font-semibold text-white">REC</span>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-x-4 top-24 p-3 rounded-xl bg-red-500/20 border border-red-500/40 backdrop-blur-md flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-300 mt-0.5 shrink-0" />
            <p className="text-sm text-red-100">{error}</p>
          </div>
        )}

        {initializing && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="text-white/80 text-sm">Starting camera…</div>
          </div>
        )}
      </div>

      {/* Bottom panel: stats + controls */}
      <div className="relative z-20 pt-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] bg-gradient-to-t from-black via-black/85 to-transparent">
        {!recordedBlob && (
          <div className="px-5 mb-4 space-y-2">
            <div className="flex gap-1.5">
              <div className="flex-1 h-1 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full bg-red-500 transition-[width] duration-200"
                  style={{ width: `${durationPct}%` }}
                />
              </div>
              <div className="flex-1 h-1 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full bg-primary-400 transition-[width] duration-200"
                  style={{ width: `${sizePct}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-mono tabular-nums ${nearingLimit ? "text-red-300" : "text-white/90"}`}>
                {formatDuration(duration)} / {formatDuration(maxDurationSec)}
              </span>
              <span className={`text-xs font-mono tabular-nums ${nearingLimit ? "text-red-300" : "text-white/90"}`}>
                {formatMB(sizeBytes)} / {maxSizeMB} MB
              </span>
            </div>
          </div>
        )}

        {recordedBlob ? (
          <div className="flex items-center justify-center gap-8 pb-4">
            <button
              onClick={handleRetake}
              className="flex flex-col items-center gap-1.5 px-6 py-2 active:scale-95 transition-transform"
            >
              <div className="w-14 h-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-white" />
              </div>
              <span className="text-xs text-white/80">Retake</span>
            </button>
            <button
              onClick={handleUse}
              className="flex flex-col items-center gap-1.5 px-6 py-2 active:scale-95 transition-transform"
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                  boxShadow: "0 4px 20px rgba(124, 58, 237, 0.4)",
                }}
              >
                <Check className="w-7 h-7 text-white" />
              </div>
              <span className="text-xs text-white/80">Use video</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center pb-2">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!!error || initializing}
              className="relative w-20 h-20 rounded-full flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
              aria-label={isRecording ? "Stop recording" : "Start recording"}
            >
              <div className={`absolute inset-0 rounded-full border-4 ${isRecording ? "border-red-500" : "border-white"}`} />
              {isRecording ? (
                <div className="w-7 h-7 rounded-md bg-red-500 flex items-center justify-center">
                  <Square className="w-4 h-4 fill-white text-white" />
                </div>
              ) : (
                <div className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center">
                  <Video className="w-6 h-6 text-white" />
                </div>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
