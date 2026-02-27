"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Square, Trash2, Send, Loader2, AlertCircle } from "lucide-react";

interface VoiceNoteRecorderProps {
  onRecordingStart?: () => void;
  onRecordingEnd?: (blob: Blob, duration: number) => void;
  onCancel?: () => void;
  onSend?: (file: File, duration: number) => void;
  isUploading?: boolean;
}

const MAX_VN_DURATION = 60; // 1 minute cap per voice note

// Resample accumulated recording peaks into fixed number of bars
function resamplePeaks(peaks: number[], numBars: number): number[] {
  if (peaks.length === 0) return Array(numBars).fill(0.3);

  const step = peaks.length / numBars;
  const resampled: number[] = [];
  for (let i = 0; i < numBars; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(Math.floor((i + 1) * step), peaks.length);
    let peak = 0;
    for (let j = start; j < end; j++) {
      if (peaks[j] > peak) peak = peaks[j];
    }
    resampled.push(peak);
  }

  const max = Math.max(...resampled, 0.01);
  return resampled.map((v) => Math.max(0.15, v / max));
}

// Check if we're in Capacitor native environment (Android only for voice recorder)
function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Only use native recorder on Android — iOS will use web MediaRecorder
  const isAndroid = /Android/.test(ua) && /wv/.test(ua);
  return isAndroid && (window as any).Capacitor !== undefined;
}

export function VoiceNoteRecorder({
  onRecordingStart,
  onRecordingEnd,
  onCancel,
  onSend,
  isUploading = false,
}: VoiceNoteRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(20).fill(0.1));
  const [debugInfo, setDebugInfo] = useState<string>("");
  const [isNative, setIsNative] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animationRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  // Web fallback refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const durationRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const webAnimationRef = useRef<number | null>(null);
  const recordedPeaksRef = useRef<number[]>([]);

  // Check if native on mount
  useEffect(() => {
    setIsNative(isCapacitorNative());
  }, []);

  // Format duration as M:SS
  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
    // Web cleanup
    if (webAnimationRef.current) {
      cancelAnimationFrame(webAnimationRef.current);
      webAnimationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    audioChunksRef.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Simulate audio levels animation during recording
  const startLevelAnimation = useCallback(() => {
    animationRef.current = setInterval(() => {
      const levels = Array(20)
        .fill(0)
        .map(() => 0.1 + Math.random() * 0.8);
      setAudioLevels(levels);
      // Accumulate average peak for waveform preview
      const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
      recordedPeaksRef.current.push(avg);
    }, 100);
  }, []);

  const stopLevelAnimation = useCallback(() => {
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
    // Show accumulated waveform in preview, or flat fallback
    setAudioLevels(resamplePeaks(recordedPeaksRef.current, 20));
  }, []);

  // =====================================================
  // NATIVE RECORDING (Capacitor)
  // =====================================================
  const startNativeRecording = async () => {
    try {
      setError(null);
      setDebugInfo("");
      setRecordedBlob(null);
      setDuration(0);
      setPermissionDenied(false);
      recordedPeaksRef.current = [];

      const { VoiceRecorder } = await import("capacitor-voice-recorder");

      // Check/request permission
      const permResult = await VoiceRecorder.requestAudioRecordingPermission();

      if (permResult.value !== true) {
        setPermissionDenied(true);
        setError("Microphone permission denied");
        return;
      }

      // Start recording
      await VoiceRecorder.startRecording();

      startTimeRef.current = Date.now();
      setIsRecording(true);
      onRecordingStart?.();

      // Start timer (auto-stops at MAX_VN_DURATION)
      durationRef.current = 0;
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(durationRef.current);

        if (durationRef.current >= MAX_VN_DURATION) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          stopNativeRecording();
        }
      }, 1000);

      // Start level animation
      startLevelAnimation();

    } catch (e: any) {

      if (e.message?.includes("permission") || e.code === "PERMISSION_DENIED") {
        setPermissionDenied(true);
        setError("Microphone permission denied");
      } else {
        setError("Could not start recording");
      }
      setDebugInfo(`Error: ${e.message || e}`);
    }
  };

  const stopNativeRecording = async () => {
    try {
      const { VoiceRecorder } = await import("capacitor-voice-recorder");

      const result = await VoiceRecorder.stopRecording();

      // Stop timer and animation
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stopLevelAnimation();
      setIsRecording(false);


      if (result.value && result.value.recordDataBase64) {
        // Convert base64 to blob
        const mimeType = result.value.mimeType || "audio/aac";
        const base64Data = result.value.recordDataBase64;


        // Convert base64 to blob
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);

        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mimeType });


        if (blob.size > 0) {
          const finalDuration = Math.round((Date.now() - startTimeRef.current) / 1000);
          setRecordedBlob(blob);
          setDuration(finalDuration);
          setDebugInfo(`${(blob.size / 1024).toFixed(1)}KB`);
          onRecordingEnd?.(blob, finalDuration);
        } else {
          setError("Recording was empty");
          setDebugInfo("Blob size: 0");
        }
      } else {
        setError("No audio data recorded");
        setDebugInfo("No data in result");
      }

    } catch (e: any) {
      setError("Failed to stop recording");
      setDebugInfo(`Error: ${e.message}`);
      setIsRecording(false);
      stopLevelAnimation();
    }
  };

  // =====================================================
  // WEB FALLBACK RECORDING (MediaRecorder API)
  // =====================================================
  const getSupportedMimeType = useCallback((): string => {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "",
    ];

    for (const type of types) {
      if (type === "" || MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "";
  }, []);

  const analyzeWebAudio = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) {
      setAudioLevels(
        Array(20)
          .fill(0)
          .map(() => 0.1 + Math.random() * 0.7)
      );
      if (mediaRecorderRef.current?.state === "recording") {
        webAnimationRef.current = requestAnimationFrame(analyzeWebAudio);
      }
      return;
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    const levels: number[] = [];
    const step = Math.floor(dataArray.length / 20);
    for (let i = 0; i < 20; i++) {
      const value = dataArray[i * step] / 255;
      levels.push(Math.max(0.1, value));
    }

    setAudioLevels(levels);

    // Accumulate average peak for waveform preview
    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    recordedPeaksRef.current.push(avg);

    if (mediaRecorderRef.current?.state === "recording") {
      webAnimationRef.current = requestAnimationFrame(analyzeWebAudio);
    }
  }, []);

  const startWebRecording = async () => {
    try {
      setError(null);
      setDebugInfo("");
      setRecordedBlob(null);
      setDuration(0);
      audioChunksRef.current = [];
      recordedPeaksRef.current = [];

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Media devices not supported");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;

      // Set up audio analyzer for visualization
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
      } catch (e) {
      }

      const mimeType = getSupportedMimeType();
      const options: MediaRecorderOptions = {};
      if (mimeType) options.mimeType = mimeType;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      setDebugInfo(`MIME: ${mediaRecorder.mimeType}`);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const totalSize = audioChunksRef.current.reduce((acc, chunk) => acc + chunk.size, 0);

        if (audioChunksRef.current.length === 0 || totalSize === 0) {
          setError("No audio was recorded");
          return;
        }

        const blob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });

        if (blob.size > 0) {
          const finalDuration = Math.round((Date.now() - startTimeRef.current) / 1000);
          setRecordedBlob(blob);
          setDuration(finalDuration);
          setDebugInfo(`${(blob.size / 1024).toFixed(1)}KB`);
          onRecordingEnd?.(blob, finalDuration);
        } else {
          setError("Recording was empty");
        }
      };

      mediaRecorder.onerror = () => {
        setError("Recording failed");
        cleanup();
      };

      mediaRecorder.start(250);
      startTimeRef.current = Date.now();
      setIsRecording(true);
      onRecordingStart?.();

      durationRef.current = 0;
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(durationRef.current);

        if (durationRef.current >= MAX_VN_DURATION) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          stopWebRecording();
        }
      }, 1000);

      webAnimationRef.current = requestAnimationFrame(analyzeWebAudio);

    } catch (e: any) {

      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setPermissionDenied(true);
        setError("Microphone permission denied");
      } else if (e.name === "NotFoundError") {
        setError("No microphone found");
      } else if (e.name === "NotReadableError") {
        setError("Microphone is in use");
      } else {
        setError(e.message || "Could not start recording");
      }

      setDebugInfo(`Error: ${e.name}`);
      cleanup();
    }
  };

  const stopWebRecording = () => {
    if (webAnimationRef.current) {
      cancelAnimationFrame(webAnimationRef.current);
      webAnimationRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    setIsRecording(false);
    // Show accumulated waveform in preview
    setAudioLevels(resamplePeaks(recordedPeaksRef.current, 20));

    setTimeout(() => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    }, 500);
  };

  // =====================================================
  // UNIFIED START/STOP
  // =====================================================
  const startRecording = async () => {
    if (isNative) {
      await startNativeRecording();
    } else {
      await startWebRecording();
    }
  };

  const stopRecording = async () => {
    if (isNative) {
      await stopNativeRecording();
    } else {
      stopWebRecording();
    }
  };

  // Cancel recording
  const handleCancel = async () => {
    if (isRecording) {
      if (isNative) {
        try {
          const { VoiceRecorder } = await import("capacitor-voice-recorder");
          await VoiceRecorder.stopRecording();
        } catch {}
      } else {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== "inactive") {
          recorder.stop();
        }
      }
    }

    cleanup();
    setIsRecording(false);
    setRecordedBlob(null);
    durationRef.current = 0;
    recordedPeaksRef.current = [];
    setDuration(0);
    setError(null);
    setDebugInfo("");
    setAudioLevels(Array(20).fill(0.1));
    onCancel?.();
  };

  // Send voice note
  const handleSend = () => {
    if (!recordedBlob) return;

    let ext = "m4a";
    const type = recordedBlob.type.toLowerCase();
    if (type.includes("webm")) ext = "webm";
    else if (type.includes("ogg")) ext = "ogg";
    else if (type.includes("mp4") || type.includes("aac")) ext = "m4a";

    const file = new File([recordedBlob], `voice-${Date.now()}.${ext}`, {
      type: recordedBlob.type,
    });


    onSend?.(file, duration);
    setRecordedBlob(null);
    durationRef.current = 0;
    recordedPeaksRef.current = [];
    setDuration(0);
    setDebugInfo("");
    cleanup();
  };

  // =====================================================
  // RENDER: Recorded State
  // =====================================================
  if (recordedBlob && !isRecording) {
    return (
      <div className="flex items-center gap-2 p-2 bg-[#1a1525] border border-white/10 rounded-2xl">
        <button
          onClick={handleCancel}
          disabled={isUploading}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors active:scale-95 disabled:opacity-50"
        >
          <Trash2 className="w-5 h-5" />
        </button>

        <div className="flex-1 flex items-center gap-0.5 h-8 px-2">
          {audioLevels.map((level, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full bg-primary-400/60"
              style={{ height: `${Math.max(20, level * 100)}%` }}
            />
          ))}
        </div>

        <div className="flex flex-col items-end shrink-0">
          <span className="text-xs font-mono text-dark-300">
            {formatDuration(duration)}
          </span>
          {debugInfo && (
            <span className="text-[9px] text-dark-500">{debugInfo}</span>
          )}
        </div>

        <button
          onClick={handleSend}
          disabled={isUploading}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-primary-600 hover:bg-primary-500 text-white transition-colors active:scale-95 disabled:opacity-50"
        >
          {isUploading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>
    );
  }

  // =====================================================
  // RENDER: Recording State
  // =====================================================
  if (isRecording) {
    return (
      <div className="flex items-center gap-2 p-2 bg-[#1a1525] border border-red-500/30 rounded-2xl">
        <button
          onClick={handleCancel}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors active:scale-95"
        >
          <Trash2 className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs text-red-400 font-medium">Recording</span>
        </div>

        <div className="flex-1 flex items-center justify-center gap-0.5 h-8">
          {audioLevels.map((level, i) => (
            <div
              key={i}
              className="w-[3px] rounded-full bg-red-400 transition-all duration-75"
              style={{ height: `${Math.max(15, level * 100)}%` }}
            />
          ))}
        </div>

        <span className={`text-xs font-mono min-w-[4.5rem] text-center transition-colors ${
          duration >= MAX_VN_DURATION - 10 ? "text-red-300 font-bold" : "text-red-400"
        }`}>
          {formatDuration(duration)}/{formatDuration(MAX_VN_DURATION)}
        </span>

        <button
          onClick={stopRecording}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-red-500 hover:bg-red-600 text-white transition-colors active:scale-95"
        >
          <Square className="w-4 h-4 fill-white" />
        </button>
      </div>
    );
  }

  // =====================================================
  // RENDER: Error State
  // =====================================================
  if (error) {
    return (
      <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-2xl">
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-red-400">{error}</p>
          {permissionDenied && (
            <p className="text-xs text-red-400/70 mt-0.5">
              Enable microphone in device settings
            </p>
          )}
          {debugInfo && (
            <p className="text-[10px] text-red-400/50 mt-0.5">{debugInfo}</p>
          )}
        </div>
        <button
          onClick={() => {
            setError(null);
            setPermissionDenied(false);
            setDebugInfo("");
          }}
          className="text-xs text-primary-400 hover:text-primary-300 shrink-0"
        >
          Dismiss
        </button>
      </div>
    );
  }

  // =====================================================
  // RENDER: Default State
  // =====================================================
  return (
    <div className="flex items-center gap-2 p-2 bg-[#1a1525] border border-white/10 rounded-2xl">
      <button
        onClick={handleCancel}
        className="w-10 h-10 rounded-full flex items-center justify-center bg-dark-800 hover:bg-dark-700 text-dark-400 transition-colors active:scale-95"
      >
        <Trash2 className="w-5 h-5" />
      </button>

      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-dark-400">Tap mic to record</span>
      </div>

      <button
        onClick={startRecording}
        className="w-10 h-10 rounded-full flex items-center justify-center bg-primary-600 hover:bg-primary-500 text-white transition-colors active:scale-95"
      >
        <Mic className="w-5 h-5" />
      </button>
    </div>
  );
}