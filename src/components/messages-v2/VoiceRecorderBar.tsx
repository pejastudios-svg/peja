"use client";

// VoiceRecorderBar
// ----------------
// Drop-in replacement that keeps the same prop shape as the previous version
// (maxSeconds, onRecordingTick, onActiveChange, onAutoStopped, onSend, onCancel)
// so the parent thread page doesn't need any changes.
//
// Behaviour
//   • Press and hold the mic -> recording starts in "gesture mode".
//       - Slide UP past the lock threshold -> recording locks (hands-free).
//         The padlock shackle visibly snaps shut.
//       - Slide LEFT past the trash threshold -> on release, the recording
//         bubble arcs into the trash can. Lid opens, dust puffs, lid closes,
//         can shakes.
//       - Release in place -> sends (calls onSend with a File).
//   • A quick tap (< 280ms with no movement) also locks the recording so the
//     user can record hands-free, then tap the trash or send button.
//   • Locked state: send button replaces the mic; trash is an interactive
//     button. Both call onSend / onCancel respectively.
//
// Why the mic <button> is a stable DOM node across state changes:
//   setPointerCapture is bound to that node on pointerdown. If the button
//   unmounted when state flipped to "holding" (which was the bug in the
//   previous version), the pointer capture would be dropped and subsequent
//   move/up events would never reach our handlers — releasing the finger
//   would silently fail to stop the recording.
//
// Padlock rendering note:
//   The unlocked shackle uses an explicit `transform-origin` in user units
//   (SVG default `transform-box` is `view-box`, so `17px 14px` is interpreted
//   in viewBox space). The previous attempt used `transform-box: fill-box`
//   which Safari handles inconsistently — the shackle rotated around the
//   wrong pivot there.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

// Shape of one dust puff spawned over the trash can on impact.
type Puff = {
  dx: number;
  dy: number;
  size: number;
  delay: number;
};
import { Mic, Send } from "lucide-react";

type VoiceRecorderBarProps = {
  maxSeconds?: number;
  onRecordingTick?: () => void;
  onActiveChange?: (active: boolean) => void;
  onAutoStopped?: () => void;
  onSend: (file: File) => void;
  onCancel?: () => void;
};

type RecState = "idle" | "holding" | "locked" | "trashing" | "sending";

// Distance (px) the user has to slide before each gesture commits. Tuned to
// match the WhatsApp / Telegram feel — small enough that a casual flick
// registers, large enough that you don't accidentally trash by jittering.
const LOCK_THRESHOLD = 50;
const TRASH_THRESHOLD = 70;

// What counts as a "tap" (press + release with no real movement).
// Generous on both axes because mobile pointer events can stretch a
// quick tap to ~400ms total and report 10px+ of phantom drift before
// touchcancel kicks in. Anything inside this box gets routed to the
// tap-to-lock branch; anything outside is treated as a deliberate
// hold + release that sends.
const TAP_MAX_MS = 500;
const TAP_MAX_DRIFT_PX = 12;

// Number of bars in the live waveform. Each one bounces independently driven
// by a sin wave + noise so the row looks like a real spectrogram.
const WAVEFORM_BARS = 20;

export function VoiceRecorderBar({
  maxSeconds = 120,
  onRecordingTick,
  onActiveChange,
  onAutoStopped,
  onSend,
  onCancel,
}: VoiceRecorderBarProps) {
  const [state, setState] = useState<RecState>("idle");
  // Mirror of `state` in a ref. Handlers like onMicPointerDown /
  // onMicPointerUp need to read the *latest* state value, but React
  // doesn't guarantee re-render before pointerup fires after a fast
  // tap — the closure captured at render time would still see "idle"
  // when pointerup hits, causing the early `if (state !== "holding")
  // return` to bail out (which is what surfaced as "first tap on
  // Android doesn't trigger anything"). Reading from a ref bypasses
  // the closure entirely.
  const stateRef = useRef<RecState>("idle");
  stateRef.current = state;
  const [elapsed, setElapsed] = useState(0);
  const [waveHeights, setWaveHeights] = useState<number[]>(() =>
    new Array(WAVEFORM_BARS).fill(4),
  );
  // 0..1 — how close we are to the lock / trash thresholds. Drives the
  // visual state of the lock pill and trash button (idle / near / armed).
  const [lockProgress, setLockProgress] = useState(0);
  const [trashProgress, setTrashProgress] = useState(0);
  // Inline transforms for the mic + bubble while the user is dragging.
  // Reset to "" when the gesture ends so the CSS transition snaps them back.
  const [micTransform, setMicTransform] = useState("");
  const [bubbleTransform, setBubbleTransform] = useState("");
  const [bubbleOpacity, setBubbleOpacity] = useState(1);
  const [lidOpen, setLidOpen] = useState(false);
  const [shake, setShake] = useState(false);
  // Dust puffs spawned on trash impact. Each render gets a fresh batch keyed
  // by `puffKey` so React mounts brand-new elements and the CSS animation
  // restarts cleanly.
  const [puffKey, setPuffKey] = useState(0);
  const [showPuffs, setShowPuffs] = useState(false);

  // Refs — gesture bookkeeping that shouldn't trigger re-renders.
  const pointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastDxRef = useRef(0);
  const lastDyRef = useRef(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartMsRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const trashRef = useRef<HTMLButtonElement | null>(null);
  // Handle to the currently running trash arc animation. Held in a ref
  // so we can `.cancel()` it from enterIdle — without that, the
  // animation's `fill: forwards` would lock the bubble at its final
  // (off-screen, opacity 0) state for every subsequent recording,
  // which is what was making the waveform appear to "freeze" after
  // the first trash.
  const trashAnimRef = useRef<Animation | null>(null);
  // The auto-stop timer (inside startTimers) needs to call completeSend
  // when the recording hits maxSeconds. completeSend is defined later
  // in the file and its closure identity changes every render. To avoid
  // either a forward-reference dance or stale closures inside the
  // interval, we stash the latest completeSend in a ref and call it
  // via `.current()` from the timer. Standard React pattern for
  // breaking a dependency cycle between hooks.
  const completeSendRef = useRef<() => Promise<void>>(async () => {});

  // The bubble + trash button stay in the layout while a recording is
  // in progress AND while the trash animation is playing out. They
  // only hide for "idle" / "sending". The previous code used
  // `isActive = holding || locked`, which collapsed both elements the
  // instant the trash animation started — leaving the Web Animations
  // API to arc an invisible bubble into an invisible trashcan.
  const isRecording = state === "holding" || state === "locked";
  const showRecordingBar = isRecording || state === "trashing";

  // Tell the parent when we start / stop being "active" so it can
  // collapse the input field and switch the wrapper to flex-1. Stays
  // true through the trash animation so the textarea doesn't pop back
  // in mid-arc.
  useEffect(() => {
    onActiveChange?.(showRecordingBar);
  }, [showRecordingBar, onActiveChange]);

  // --- Audio capture ---------------------------------------------------------
  const startAudioCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      // No timeslice. iOS WKWebView's MediaRecorder records to MP4,
      // and calling `start(N)` produces files with an incomplete moov
      // atom that no browser will play back (flat-waveform bubble,
      // play button does nothing — exactly the symptom users hit on
      // iPhone). A bare `start()` emits one dataavailable + onstop on
      // .stop(), and the resulting blob is a properly-formed file.
      // Chrome / Android WebView produce playable webm either way, so
      // the change is iOS-correct and Android-neutral.
      mr.start();
      mediaRecorderRef.current = mr;
    } catch (err) {
      // Permission denied or no mic — fail quietly and let the user retry.
      // We still show the UI so the gesture itself feels right; the resulting
      // file will just be empty and the parent's send will no-op.
      console.warn("VoiceRecorderBar: getUserMedia failed", err);
    }
  }, []);

  const stopAudioCapture = useCallback(async (): Promise<File | null> => {
    const mr = mediaRecorderRef.current;
    const stream = audioStreamRef.current;
    audioStreamRef.current = null;
    mediaRecorderRef.current = null;

    const result = await new Promise<File | null>((resolve) => {
      if (!mr || mr.state === "inactive") {
        resolve(null);
        return;
      }
      mr.onstop = () => {
        const chunks = audioChunksRef.current;
        if (!chunks.length) {
          resolve(null);
          return;
        }
        // Strip codec parameters from the MIME (e.g. "audio/webm;codecs=opus"
        // → "audio/webm"). The full string is fine as a MediaRecorder input
        // but some object stores serve it back with a mangled Content-Type
        // (e.g. the semicolon gets URL-encoded or the codec param is
        // dropped without renormalising), which then breaks <audio> on
        // certain browsers — the player silently fails to decode. The
        // base MIME alone is universally understood by browsers when
        // playing back a properly-formed file.
        const fullType = mr.mimeType || "audio/webm";
        const type = fullType.split(";")[0].trim() || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : "webm";
        const blob = new Blob(chunks, { type });
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
        resolve(file);
      };
      try {
        mr.stop();
      } catch {
        resolve(null);
      }
    });

    stream?.getTracks().forEach((t) => t.stop());
    audioChunksRef.current = [];
    return result;
  }, []);

  const discardAudioCapture = useCallback(() => {
    const mr = mediaRecorderRef.current;
    const stream = audioStreamRef.current;
    audioStreamRef.current = null;
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    try {
      if (mr && mr.state !== "inactive") mr.stop();
    } catch {
      /* noop */
    }
    stream?.getTracks().forEach((t) => t.stop());
  }, []);

  // --- Timer + waveform ------------------------------------------------------
  const startTimers = useCallback(() => {
    // Defensive: clear any leftover intervals before scheduling new
    // ones. stopTimers should always run between recordings, but if a
    // race or an unmount mid-flight left a ref dangling we'd otherwise
    // run two intervals at once (both pumping setWaveHeights) and the
    // bars would visibly stutter.
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (waveIntervalRef.current) clearInterval(waveIntervalRef.current);
    recordingStartMsRef.current = Date.now();
    setElapsed(0);
    timerIntervalRef.current = setInterval(() => {
      const e = Math.floor((Date.now() - recordingStartMsRef.current) / 1000);
      setElapsed(e);
      onRecordingTick?.();
      if (maxSeconds && e >= maxSeconds) {
        onAutoStopped?.();
        // Auto-send the recording we have so far. Indirected through
        // completeSendRef so the timer always invokes the latest
        // closure (see the ref declaration up top for why).
        void completeSendRef.current();
      }
    }, 250);
    waveIntervalRef.current = setInterval(() => {
      // sin + noise mix gives an organic-looking spectrogram without
      // needing an actual AudioContext analyser hooked up. The phase
      // changes with time so the bars genuinely move from frame to
      // frame. The faster `t` (180 vs 220) and the layered second sin
      // wave give the row a noticeably "alive" feel rather than a
      // gentle hum — important because users use this as a tell that
      // the mic is actually hot, especially after tap-to-lock (where
      // they aren't holding anymore so the motion is the only signal).
      const t = Date.now() / 180;
      setWaveHeights((prev) =>
        prev.map((_, i) => {
          const phase = i * 0.55;
          const v =
            5 +
            Math.abs(Math.sin(t + phase)) * 10 +
            Math.abs(Math.sin(t * 1.6 + phase * 1.7)) * 3 +
            Math.random() * 4;
          return Math.round(v);
        }),
      );
    }, 70);
  }, [maxSeconds, onRecordingTick, onAutoStopped]);

  const stopTimers = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (waveIntervalRef.current) clearInterval(waveIntervalRef.current);
    timerIntervalRef.current = null;
    waveIntervalRef.current = null;
  }, []);

  // --- State transitions -----------------------------------------------------
  const resetVisuals = useCallback(() => {
    setLockProgress(0);
    setTrashProgress(0);
    setMicTransform("");
    setBubbleTransform("");
    setBubbleOpacity(1);
    setLidOpen(false);
    setShake(false);
    setShowPuffs(false);
    setWaveHeights(new Array(WAVEFORM_BARS).fill(4));
  }, []);

  const enterIdle = useCallback(() => {
    // Cancel any in-flight (or `fill: forwards` parked) trash animation
    // on the bubble. Without this, the Web Animations API would keep
    // the bubble's transform/opacity locked at the trash-final values
    // forever, which freezes the waveform off-screen on the next
    // recording. Also explicitly clear inline style overrides that the
    // animation set (transition + style.transform / opacity).
    if (trashAnimRef.current) {
      try { trashAnimRef.current.cancel(); } catch { /* noop */ }
      trashAnimRef.current = null;
    }
    if (bubbleRef.current) {
      bubbleRef.current.getAnimations().forEach((a) => {
        try { a.cancel(); } catch { /* noop */ }
      });
      bubbleRef.current.style.transition = "";
      bubbleRef.current.style.transform = "";
      bubbleRef.current.style.opacity = "";
    }
    setState("idle");
    setElapsed(0);
    resetVisuals();
  }, [resetVisuals]);

  const enterLocked = useCallback(() => {
    setState("locked");
    setMicTransform("");
    setBubbleTransform("");
    setBubbleOpacity(1);
    // Snap the lock visual to "fully closed" — keeps the shackle animation
    // running into its final position rather than jumping there abruptly.
    setLockProgress(1);
    setTrashProgress(0);
  }, []);

  // --- Pointer handlers (mic button) ----------------------------------------
  // All four read `stateRef.current` instead of `state` directly. The
  // closure-captured `state` value from the previous render can lag
  // behind the actual one when two pointer events arrive in the same
  // frame (the common "fast tap on mobile" case), causing the early-
  // return guards to bail unexpectedly.
  const onMicPointerDown = (e: ReactPointerEvent) => {
    if (stateRef.current !== "idle") return;
    e.preventDefault();
    pointerIdRef.current = e.pointerId;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    stateRef.current = "holding";
    setState("holding");
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startTimeRef.current = Date.now();
    lastDxRef.current = 0;
    lastDyRef.current = 0;
    void startAudioCapture();
    startTimers();
  };

  const onMicPointerMove = (e: ReactPointerEvent) => {
    if (stateRef.current !== "holding" || e.pointerId !== pointerIdRef.current)
      return;
    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;
    lastDxRef.current = dx;
    lastDyRef.current = dy;

    // Vertical — lock progress. Only "up" matters (negative dy).
    if (dy < 0) {
      setLockProgress(Math.min(1, -dy / LOCK_THRESHOLD));
    } else {
      setLockProgress(0);
    }

    // Horizontal — trash progress. Only "left" matters (negative dx).
    if (dx < 0) {
      const p = Math.min(1, -dx / TRASH_THRESHOLD);
      setTrashProgress(p);
      // Dampened follow — the mic and bubble move at half the finger's pace
      // so the user can see the trash icon arming before they fully commit.
      setMicTransform(`translateX(${(dx * 0.5).toFixed(1)}px) scale(${(1.15 - p * 0.06).toFixed(2)})`);
      setBubbleTransform(`translateX(${(dx * 0.2).toFixed(1)}px)`);
      setBubbleOpacity(1 - p * 0.5);
      setLidOpen(p >= 1);
    } else {
      setTrashProgress(0);
      setMicTransform("");
      setBubbleTransform("");
      setBubbleOpacity(1);
      setLidOpen(false);
    }
  };

  const onMicPointerUp = (e: ReactPointerEvent) => {
    if (stateRef.current !== "holding" || e.pointerId !== pointerIdRef.current)
      return;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    pointerIdRef.current = null;
    const dx = lastDxRef.current;
    const dy = lastDyRef.current;
    const held = Date.now() - startTimeRef.current;

    if (-dx > TRASH_THRESHOLD) {
      void runTrashAnimation();
    } else if (-dy > LOCK_THRESHOLD) {
      enterLocked();
    } else if (held < TAP_MAX_MS && Math.abs(dx) < TAP_MAX_DRIFT_PX && Math.abs(dy) < TAP_MAX_DRIFT_PX) {
      // Treated as a tap — lock and stay recording so the user can hit
      // trash or send without holding their finger down. The tap window
      // is wide (500ms / 12px) because mobile event timing can stretch
      // a "quick tap" beyond a strict 280ms / 8px box (iOS especially
      // reports small jitter and slight event delay), and we'd rather
      // err on the side of locking than send an accidental half-second
      // recording.
      enterLocked();
    } else {
      void completeSend();
    }
  };

  const onMicPointerCancel = () => {
    if (stateRef.current === "holding") {
      stopTimers();
      discardAudioCapture();
      onCancel?.();
      enterIdle();
    }
  };

  // --- Click handlers (locked state) ----------------------------------------
  const onTrashButtonClick = () => {
    if (stateRef.current === "locked") void runTrashAnimation();
  };
  const onSendButtonClick = () => {
    if (stateRef.current === "locked") void completeSend();
  };

  // --- Async actions ---------------------------------------------------------
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const runTrashAnimation = async () => {
    if (state === "trashing") return;
    setState("trashing");
    stopTimers();

    // Discard audio without waiting — we don't need the blob.
    discardAudioCapture();

    // 1. Open the lid as a tell-tale before the throw lands.
    setLidOpen(true);
    setTrashProgress(1);
    await sleep(170);

    // 2. Arc the bubble into the trash. We use the Web Animations API with
    //    an explicit 3-keyframe arc so the bubble lifts on the way over and
    //    crashes down into the can.
    if (bubbleRef.current && trashRef.current) {
      const bRect = bubbleRef.current.getBoundingClientRect();
      const tRect = trashRef.current.getBoundingClientRect();
      const dx = tRect.left + tRect.width / 2 - (bRect.left + bRect.width / 2);
      const dy = tRect.top + tRect.height * 0.3 - (bRect.top + bRect.height / 2);
      // The bubble may already be transformed from the slide-left gesture;
      // read the current matrix so the arc starts from where the user left
      // it (no visible snap-back).
      const m = new DOMMatrix(getComputedStyle(bubbleRef.current).transform);
      const sx = m.m41 || 0;
      const sy = m.m42 || 0;
      const startOp = parseFloat(getComputedStyle(bubbleRef.current).opacity) || 1;
      bubbleRef.current.style.transition = "none";
      // Store the handle so enterIdle can cancel it — otherwise
      // `fill: forwards` keeps the bubble parked at the final keyframe
      // (off-screen, opacity 0) and the waveform on the next recording
      // is rendered into an invisible container.
      trashAnimRef.current = bubbleRef.current.animate(
        [
          { transform: `translate(${sx}px, ${sy}px) scale(1) rotate(0deg)`, opacity: startOp, offset: 0 },
          {
            transform: `translate(${(sx + dx * 0.45).toFixed(1)}px, ${(sy + dy * 0.4 - 30).toFixed(1)}px) scale(0.55) rotate(-90deg)`,
            opacity: 0.95,
            offset: 0.55,
          },
          {
            transform: `translate(${(sx + dx).toFixed(1)}px, ${(sy + dy).toFixed(1)}px) scale(0.05) rotate(-220deg)`,
            opacity: 0,
            offset: 1,
          },
        ],
        { duration: 560, easing: "cubic-bezier(0.4, 0, 0.7, 1)", fill: "forwards" },
      );
    }

    await sleep(490);

    // 3. Dust puffs out of the can on impact.
    setPuffKey((k) => k + 1);
    setShowPuffs(true);

    // 4. Close the lid + shake the can to settle the contents.
    await sleep(110);
    setLidOpen(false);
    setShake(true);

    await sleep(580);
    setShake(false);
    setShowPuffs(false);

    await sleep(260);
    onCancel?.();
    enterIdle();
  };

  const completeSend = async () => {
    if (state === "trashing" || state === "sending") return;
    setState("sending");
    stopTimers();

    const file = await stopAudioCapture();
    if (file) onSend(file);
    else onCancel?.();

    await sleep(220);
    enterIdle();
  };
  // Keep completeSendRef pointing at the latest closure. Assigning a
  // ref during render is supported by React and side-steps the
  // exhaustive-deps lint complaint about startTimers — the interval
  // always calls the most recent completeSend without us having to
  // include it in startTimers' deps (which would re-create the
  // callback every render).
  completeSendRef.current = completeSend;

  // --- Dust puff positions ---------------------------------------------------
  // Recompute each batch when puffKey changes (i.e. a fresh trash
  // animation just landed). Using state + effect rather than useMemo
  // because puffKey is a *trigger*, not an input the memo body reads —
  // useMemo with [puffKey] but no in-body reference is the classic
  // case the exhaustive-deps rule (rightly) flags. Effect makes the
  // dependency real and self-documenting.
  const [puffs, setPuffs] = useState<Puff[]>([]);
  useEffect(() => {
    if (puffKey === 0) return; // no spawn yet
    const N = 12;
    setPuffs(
      Array.from({ length: N }, (_, i) => {
        const angle = -Math.PI * 0.95 + (i / (N - 1)) * Math.PI * 0.9;
        const dist = 18 + Math.random() * 22;
        return {
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          size: 4 + Math.random() * 8,
          delay: Math.random() * 90,
        };
      })
    );
  }, [puffKey]);

  // --- Derived UI state ------------------------------------------------------
  const isLockNear = lockProgress > 0.55;
  const isLockArmed = lockProgress >= 1;
  const isTrashNear = trashProgress > 0.55 && trashProgress < 1;
  const isTrashArmed = trashProgress >= 1;
  // Shackle "open" means the padlock is visually NOT closed yet — i.e. it's
  // floating with a tilt. As lockProgress crosses 1 we snap it shut.
  const shackleOpen = !isLockArmed && state !== "locked";

  const timerLabel = useMemo(() => {
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [elapsed]);

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    <div
      className={`w-full h-full flex items-center gap-2 ${showRecordingBar ? "" : "justify-end"}`}
    >
      <style>{`
        @keyframes vrb-rec-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.78); }
        }
        @keyframes vrb-arr-slide {
          0%, 100% { transform: translateX(0); opacity: 0.3; }
          50% { transform: translateX(-5px); opacity: 1; }
        }
        @keyframes vrb-arr-up {
          0%, 100% { transform: translateY(0); opacity: 0.3; }
          50% { transform: translateY(-3px); opacity: 0.85; }
        }
        @keyframes vrb-mic-ring {
          0% { transform: scale(0.85); opacity: 0.5; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes vrb-trash-shake {
          0%, 100% { transform: rotate(0); }
          16% { transform: rotate(-8deg); }
          32% { transform: rotate(7deg); }
          48% { transform: rotate(-5deg); }
          64% { transform: rotate(3deg); }
          82% { transform: rotate(-1deg); }
        }
        @keyframes vrb-puff {
          0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0.85; }
          60% { opacity: 0.55; }
          100% {
            transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(2.4);
            opacity: 0;
          }
        }
      `}</style>

      {/* === TRASH BUTTON (left side, recording only) =========================
          Hidden when idle. Becomes the slide-left target during holding and
          a tappable button when locked. */}
      <button
        ref={trashRef}
        type="button"
        onClick={onTrashButtonClick}
        aria-label="Discard voice note"
        className={`relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ease-out ${
          showRecordingBar ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none w-0 h-0"
        }`}
        style={{
          background: isTrashArmed ? "#E24B4A" : isTrashNear ? "#5c1a1a" : "var(--chat-input-bg, #1f1f24)",
          border: `0.5px solid ${
            isTrashArmed ? "#A32D2D" : isTrashNear ? "#E24B4A" : "var(--chat-input-border, rgba(255,255,255,0.08))"
          }`,
          color: isTrashArmed ? "#fff" : isTrashNear ? "#ff8a8a" : "#9b9ba2",
          transform: isTrashArmed ? "scale(1.28)" : isTrashNear ? "scale(1.15)" : undefined,
        }}
      >
        <TrashCanSVG lidOpen={lidOpen} shake={shake} />
        {/* Dust puffs spawn over the trash. Pointer-events-none so they
            don't block clicks on the trash button itself. */}
        {showPuffs && (
          <div className="absolute inset-0 pointer-events-none overflow-visible">
            {puffs.map((p, i) => (
              <span
                key={`${puffKey}-${i}`}
                className="absolute rounded-full"
                style={
                  {
                    background: "rgba(180,170,160,0.6)",
                    left: "50%",
                    top: "30%",
                    width: p.size,
                    height: p.size,
                    transform: "translate(-50%, -50%)",
                    animation: "vrb-puff 950ms ease-out forwards",
                    animationDelay: `${p.delay}ms`,
                    "--dx": `${p.dx}px`,
                    "--dy": `${p.dy}px`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}
      </button>

      {/* === RECORDING BUBBLE (middle, recording only) ========================
          Live timer + waveform + "← Slide to cancel" hint. The bubble itself
          carries the slide-left transform so it visibly trails the mic. */}
      <div
        ref={bubbleRef}
        className={`flex-1 min-w-0 h-10 rounded-3xl flex items-center gap-2 px-3 transition-opacity duration-200 ${
          showRecordingBar ? "opacity-100" : "opacity-0 pointer-events-none w-0"
        }`}
        style={{
          background: "var(--chat-input-bg, #1f1f24)",
          transform: bubbleTransform || undefined,
          opacity: bubbleOpacity * (showRecordingBar ? 1 : 0),
          transition: bubbleTransform ? "none" : "transform 200ms ease, opacity 200ms ease",
        }}
      >
        <span
          aria-hidden
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: "#E24B4A", animation: "vrb-rec-pulse 1.4s ease-in-out infinite" }}
        />
        <span className="text-[13px] font-medium tabular-nums min-w-[34px] text-white">{timerLabel}</span>
        <div className="flex-1 flex items-center gap-[2px] h-[22px] overflow-hidden min-w-0">
          {waveHeights.map((h, i) => (
            <span
              key={i}
              className="flex-1 min-w-[2px] rounded-sm"
              style={{
                height: h,
                background: "#b39df8",
                opacity: 0.85,
                // 80ms transition is just slightly longer than the 70ms
                // tick — bars are constantly redrawing toward the next
                // target which makes the row read as continuous motion
                // rather than discrete frames.
                transition: "height 80ms linear",
              }}
            />
          ))}
        </div>
        {state === "locked" ? (
          <SmallLockedIcon />
        ) : (
          <span className="text-[12px] text-dark-300 flex items-center gap-1 whitespace-nowrap shrink-0">
            <span style={{ display: "inline-block", animation: "vrb-arr-slide 1.4s ease-in-out infinite" }}>←</span>
            <span>Slide to cancel</span>
          </span>
        )}
      </div>

      {/* === MIC + LOCK + SEND area (right side, always present) ============
          The mic button is the same DOM node across state changes so
          setPointerCapture survives the transition into "holding". The send
          button overlays the mic; we crossfade between them. */}
      <div className="relative shrink-0 w-10 h-10">
        {/* Lock pill — floats above the mic when recording. The shackle
            opens/closes based on lockProgress. */}
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 w-[38px] flex flex-col items-center justify-center rounded-[19px] pointer-events-none"
          style={{
            bottom: "52px",
            minHeight: "62px",
            paddingTop: 8,
            paddingBottom: 6,
            background: isLockNear || isLockArmed || state === "locked" ? "#2d1f4d" : "var(--chat-input-bg, #1f1f24)",
            border: `0.5px solid ${
              isLockNear || isLockArmed || state === "locked" ? "#8b5cf6" : "rgba(255,255,255,0.1)"
            }`,
            color: isLockNear || isLockArmed || state === "locked" ? "#c4b5fd" : "#9b9ba2",
            opacity: isRecording && state !== "locked" ? 1 : state === "locked" ? 0 : 0,
            transform:
              isRecording && state !== "locked"
                ? `translateY(${isLockNear ? -10 : 0}px) scale(${isLockArmed || isLockNear ? 1.16 : 1})`
                : "translateY(15px) scale(0.6)",
            transition:
              "opacity 300ms, transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), background 250ms, border-color 250ms, color 250ms",
            zIndex: 20,
          }}
        >
          <PadlockSVG open={shackleOpen} />
          <UpArrowSVG
            // The little ↑ animates only while the lock isn't armed; once
            // armed/near we hide it so the icon doesn't fight with the
            // confirmation state.
            visible={!isLockNear && !isLockArmed && state !== "locked"}
          />
        </div>

        {/* Pulsing red ring around the mic while holding. Pure decoration. */}
        <div
          aria-hidden
          className="absolute -inset-1.5 rounded-full pointer-events-none"
          style={{
            border: "2px solid #E24B4A",
            opacity: 0,
            animation: state === "holding" ? "vrb-mic-ring 1.6s ease-out infinite" : undefined,
          }}
        />

        {/* SEND button — overlays the mic position when locked. */}
        <button
          type="button"
          onClick={onSendButtonClick}
          aria-label="Send voice note"
          className="absolute inset-0 w-10 h-10 rounded-full flex items-center justify-center"
          style={{
            background: "#8b5cf6",
            color: "#fff",
            opacity: state === "locked" ? 1 : 0,
            pointerEvents: state === "locked" ? "auto" : "none",
            transform: state === "locked" ? "scale(1)" : "scale(0.4)",
            transition: "opacity 250ms, transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <Send className="w-4 h-4" />
        </button>

        {/* MIC button — stable DOM node across state changes. */}
        <button
          type="button"
          onPointerDown={onMicPointerDown}
          onPointerMove={onMicPointerMove}
          onPointerUp={onMicPointerUp}
          onPointerCancel={onMicPointerCancel}
          aria-label="Hold to record voice note"
          className="absolute inset-0 w-10 h-10 rounded-full flex items-center justify-center select-none"
          style={{
            background: state === "holding" ? "#E24B4A" : "#8b5cf6",
            color: "#fff",
            opacity: state === "locked" || state === "trashing" || state === "sending" ? 0 : 1,
            pointerEvents: state === "locked" || state === "trashing" || state === "sending" ? "none" : "auto",
            transform: micTransform || (state === "holding" ? "scale(1.15)" : "scale(1)"),
            transition: micTransform
              ? "none"
              : "transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1), background 250ms, opacity 250ms",
            touchAction: "none",
          }}
        >
          <Mic className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Padlock — the unlocked state is the one that needed fixing. We anchor the
// shackle's rotation at the right leg's bottom (SVG coords 17, 14) using an
// explicit transform-origin in user units. The default `transform-box` on
// SVG elements is `view-box`, so a px value here is interpreted in viewBox
// space — consistent across Chrome / Safari / Firefox.
// ============================================================================

function PadlockSVG({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 28"
      width="20"
      height="22"
      style={{ overflow: "visible", display: "block" }}
      aria-hidden
    >
      {/* The shackle is one continuous path forming the inverted-U on top of
          the body. When "open" we rotate it ~32° clockwise around the right
          leg's base AND nudge it up-left a couple of pixels so the left leg
          visibly lifts out of the body. */}
      <path
        d="M 7 14 V 10 Q 7 4 12 4 Q 17 4 17 10 V 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{
          transformOrigin: "17px 14px",
          transform: open ? "translate(-3px, -2px) rotate(32deg)" : "none",
          transition: "transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
      {/* Body. Sits behind the shackle so the open shackle visibly clears
          the top edge. */}
      <rect x="5" y="13" width="14" height="13" rx="2" fill="currentColor" />
      {/* Keyhole — darker dot + slot. Painted with a translucent black so
          it darkens whatever currentColor is set to. */}
      <circle cx="12" cy="19" r="1.5" fill="rgba(0,0,0,0.45)" />
      <rect x="11.3" y="19.5" width="1.4" height="3.5" fill="rgba(0,0,0,0.45)" />
    </svg>
  );
}

function UpArrowSVG({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox="0 0 14 14"
      width="11"
      height="11"
      style={{
        marginTop: 4,
        opacity: visible ? 0.55 : 0,
        animation: visible ? "vrb-arr-up 1.4s ease-in-out infinite" : undefined,
        transition: "opacity 200ms",
        display: "block",
      }}
      aria-hidden
    >
      <path
        d="M 7 11 L 7 3 M 3 6 L 7 2 L 11 6"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Small closed-padlock that lives INSIDE the recording bubble once locked.
// Mirrors Telegram's behaviour — confirms the recording is now hands-free.
function SmallLockedIcon() {
  return (
    <svg
      viewBox="0 0 20 24"
      width="14"
      height="16"
      style={{ color: "#b39df8", flexShrink: 0 }}
      aria-hidden
    >
      <path
        d="M 6 12 L 6 8 Q 6 3 10 3 Q 14 3 14 8 L 14 12"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="4" y="11" width="12" height="11" rx="2" fill="currentColor" />
    </svg>
  );
}

// ============================================================================
// Trash can — the lid pivots open from its right corner. We use
// transform-origin in fill-box units (more localised, but only for this group
// — not the whole SVG). Falls back gracefully because we also include the
// origin in user-units that match the same point.
// ============================================================================

function TrashCanSVG({ lidOpen, shake }: { lidOpen: boolean; shake: boolean }) {
  return (
    <svg
      viewBox="0 0 26 30"
      width="22"
      height="26"
      style={{
        fill: "currentColor",
        overflow: "visible",
        display: "block",
        animation: shake ? "vrb-trash-shake 600ms ease-in-out" : undefined,
        transformOrigin: "13px 27px",
      }}
      aria-hidden
    >
      <g
        style={{
          // Pivot at the bottom-right corner of the lid. SVG y points
          // DOWN, so a positive rotation is clockwise in screen terms
          // — which here sweeps the left edge UP and to the LEFT,
          // away from the bin body. The previous -50deg rotated
          // counter-clockwise and pushed the lid INTO the body.
          transformOrigin: "24px 7px",
          transform: lidOpen ? "rotate(50deg) translateY(-1px)" : "none",
          transition: "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <rect x="10" y="0" width="6" height="2.5" rx="1.25" />
        <rect x="2" y="3.5" width="22" height="3.5" rx="1.5" />
      </g>
      <path d="M 5 9 L 6 27 Q 6 29 8 29 L 18 29 Q 20 29 20 27 L 21 9 Z" />
      <line x1="10" y1="13" x2="10" y2="25" stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
      <line x1="13" y1="13" x2="13" y2="25" stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
      <line x1="16" y1="13" x2="16" y2="25" stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
    </svg>
  );
}
