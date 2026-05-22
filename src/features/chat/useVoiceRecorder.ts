"use client";

// Voice recorder hook for v2 chat. Picks the right backend per
// platform and surfaces a uniform interface to the UI:
//
//   • On Android (Capacitor WebView): `capacitor-voice-recorder`
//     plugin. Records to AAC/M4A, returns base64 we re-wrap as a Blob.
//     Crucial for Android because MediaRecorder inside the Capacitor
//     WebView is unreliable on older Android versions.
//
//   • Elsewhere (web, iOS Safari): web `MediaRecorder` API on a
//     `navigator.mediaDevices.getUserMedia({audio:true})` stream.
//     Records to whatever opus/webm/mp4 the browser supports.
//
// API:
//   const v = useVoiceRecorder({ maxSeconds, onAutoStop });
//   await v.start();      // request permission, begin recording
//   const { blob, duration } = await v.stop(); // finish + get bytes
//   v.cancel();           // throw away the recording
//   v.state               // "idle" | "starting" | "recording" | "processing"
//   v.duration            // seconds, ticks every 100 ms while recording
//   v.amplitude           // live mic level 0..1 for waveform / pulse
//
// All internal state cleans up automatically on unmount: any active
// stream tracks get stopped, AudioContext closes, timers clear.

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "starting" | "recording" | "processing";

export interface RecorderResult {
  blob: Blob;
  duration: number; // seconds
  mimeType: string;
}

interface UseVoiceRecorderArgs {
  // Auto-stop after this many seconds. Default 120 (2 minutes).
  maxSeconds?: number;
  // Fires when auto-stop kicks in (so the UI can surface a toast and
  // route to "send" rather than "preview"). Receives the recorded
  // result, same shape as stop() resolves with.
  onAutoStop?: (result: RecorderResult) => void;
}

export function useVoiceRecorder(args: UseVoiceRecorderArgs = {}) {
  const maxSeconds = args.maxSeconds ?? 120;

  const [state, setState] = useState<RecorderState>("idle");
  const [duration, setDuration] = useState(0);
  const [amplitude, setAmplitude] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Backend-specific refs — kept outside React state because they
  // mutate every animation frame and don't need to trigger renders.
  const isNativeRef = useRef(false);
  const startedAtRef = useRef(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Web (MediaRecorder) refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  // Most-recent auto-stop handler ref so the timer can call the
  // current callback even if the component re-renders mid-recording.
  const onAutoStopRef = useRef(args.onAutoStop);
  useEffect(() => { onAutoStopRef.current = args.onAutoStop; }, [args.onAutoStop]);

  // Detect native Android once on mount. iOS uses MediaRecorder; web
  // uses MediaRecorder. Only Android Capacitor flips this.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent || "";
    const isAndroid = /Android/.test(ua) && /wv/.test(ua);
    isNativeRef.current =
      isAndroid && (window as unknown as { Capacitor?: unknown }).Capacitor !== undefined;
  }, []);

  // -----------------------------------------------------
  // Cleanup
  // -----------------------------------------------------
  const cleanupTimers = useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  // Tear everything down on unmount so we don't leak the mic light.
  useEffect(() => {
    return () => {
      cleanupTimers();
      cleanupStream();
      // If we're still mid-record on unmount, ask the native plugin
      // to stop so the OS releases the mic.
      if (isNativeRef.current && state === "recording") {
        import("capacitor-voice-recorder").then(({ VoiceRecorder }) => {
          VoiceRecorder.stopRecording().catch(() => {});
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------
  // Web MediaRecorder backend
  // -----------------------------------------------------
  const pickWebMime = useCallback((): string => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "",
    ];
    for (const t of candidates) {
      if (t === "" || MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }, []);

  const startAmplitudeLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      // Average the low/mid bands — voice sits around 200–3000 Hz so
      // skipping the topmost frequencies makes the meter more
      // responsive to actual speech and less to room noise.
      let sum = 0;
      const lim = Math.min(buf.length, 32);
      for (let i = 0; i < lim; i++) sum += buf[i];
      const level = Math.min(1, (sum / lim) / 128);
      setAmplitude(level);
      if (mediaRecorderRef.current?.state === "recording") {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // Native backend can't expose the audio buffer directly, so we
  // animate amplitude pseudo-randomly while recording. UX-equivalent
  // — the user just needs to see something pulsing.
  const startNativeAmplitudePulse = useCallback(() => {
    const tick = () => {
      setAmplitude(0.25 + Math.random() * 0.5);
    };
    rafRef.current = window.setInterval(tick, 80) as unknown as number;
  }, []);

  // -----------------------------------------------------
  // start
  // -----------------------------------------------------
  const start = useCallback(async (): Promise<void> => {
    if (state !== "idle") return;
    setState("starting");
    setPermissionDenied(false);
    setDuration(0);
    setAmplitude(0);
    chunksRef.current = [];

    try {
      if (isNativeRef.current) {
        const { VoiceRecorder } = await import("capacitor-voice-recorder");
        const perm = await VoiceRecorder.requestAudioRecordingPermission();
        if (perm.value !== true) {
          setPermissionDenied(true);
          setState("idle");
          return;
        }
        await VoiceRecorder.startRecording();
        startNativeAmplitudePulse();
      } else {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("getUserMedia not supported");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;

        // Audio analyser for the live waveform / mic pulse.
        try {
          const AC = (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext);
          const ac = new AC();
          audioContextRef.current = ac;
          const src = ac.createMediaStreamSource(stream);
          const an = ac.createAnalyser();
          an.fftSize = 256;
          src.connect(an);
          analyserRef.current = an;
        } catch {
          // If the AnalyserNode setup fails, recording still works,
          // amplitude just stays at 0. Not fatal.
        }

        const mime = pickWebMime();
        const opts: MediaRecorderOptions = {};
        if (mime) opts.mimeType = mime;
        const mr = new MediaRecorder(stream, opts);
        mediaRecorderRef.current = mr;

        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.start(250); // emit chunks every 250 ms so we don't lose
                       // data if recording is suddenly killed.
        startAmplitudeLoop();
      }

      startedAtRef.current = Date.now();
      setState("recording");

      tickerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startedAtRef.current) / 1000;
        setDuration(elapsed);
      }, 100);

      // Auto-stop at maxSeconds. We schedule the stop callback inline
      // — the UI is notified via onAutoStop so it can decide whether
      // to auto-send or just preview.
      autoStopTimerRef.current = setTimeout(async () => {
        try {
          const result = await stopInternal();
          onAutoStopRef.current?.(result);
        } catch (e) {
          console.warn("[voice] auto-stop failed", e);
        }
      }, maxSeconds * 1000);
    } catch (e) {
      console.error("[voice] start failed", e);
      cleanupTimers();
      cleanupStream();
      setState("idle");
      if ((e as { message?: string })?.message?.toLowerCase().includes("permission")) {
        setPermissionDenied(true);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // -----------------------------------------------------
  // stop (returns the recorded blob)
  // -----------------------------------------------------
  // Internal: actually finishes the recording and returns the bytes.
  // Both the manual stop() and the auto-stop timer call this.
  const stopInternal = useCallback(async (): Promise<RecorderResult> => {
    setState("processing");
    cleanupTimers();
    const finalDuration = Math.max(
      0,
      (Date.now() - startedAtRef.current) / 1000
    );

    let blob: Blob;
    let mimeType: string;

    if (isNativeRef.current) {
      const { VoiceRecorder } = await import("capacitor-voice-recorder");
      const result = await VoiceRecorder.stopRecording();
      const data = result.value?.recordDataBase64;
      mimeType = result.value?.mimeType || "audio/aac";
      if (!data) throw new Error("native recorder returned no data");
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: mimeType });
    } else {
      const mr = mediaRecorderRef.current;
      if (!mr) throw new Error("no active web recorder");
      mimeType = mr.mimeType || "audio/webm";
      // Wrap the asynchronous onstop in a Promise. The recorder
      // queues a final dataavailable event right before onstop, so
      // chunks are complete by the time we resolve.
      blob = await new Promise<Blob>((resolve, reject) => {
        mr.onstop = () => {
          const total = chunksRef.current.reduce((a, c) => a + c.size, 0);
          if (total === 0) {
            reject(new Error("empty recording"));
            return;
          }
          resolve(new Blob(chunksRef.current, { type: mimeType }));
        };
        mr.onerror = () => reject(new Error("MediaRecorder error"));
        try { mr.stop(); } catch (e) { reject(e); }
      });
      cleanupStream();
    }

    setState("idle");
    setAmplitude(0);
    return { blob, duration: finalDuration, mimeType };
  }, [cleanupTimers, cleanupStream]);

  const stop = useCallback(async (): Promise<RecorderResult> => {
    if (state !== "recording") {
      throw new Error(`cannot stop from state ${state}`);
    }
    return stopInternal();
  }, [state, stopInternal]);

  // -----------------------------------------------------
  // cancel (discard the recording)
  // -----------------------------------------------------
  const cancel = useCallback(async (): Promise<void> => {
    cleanupTimers();
    if (isNativeRef.current && state === "recording") {
      try {
        const { VoiceRecorder } = await import("capacitor-voice-recorder");
        await VoiceRecorder.stopRecording();
      } catch {}
    } else if (mediaRecorderRef.current?.state === "recording") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    cleanupStream();
    chunksRef.current = [];
    setState("idle");
    setDuration(0);
    setAmplitude(0);
  }, [cleanupTimers, cleanupStream, state]);

  return {
    state,
    duration,
    amplitude,
    permissionDenied,
    start,
    stop,
    cancel,
  };
}
