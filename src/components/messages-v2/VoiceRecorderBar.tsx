"use client";

// Voice-note input bar. WhatsApp-style hold-to-record:
//
//   • Press and HOLD the mic button to start recording.
//   • Release (without dragging) to stop and send.
//   • While still holding, drag finger LEFT past the cancel threshold
//     to discard the recording on release.
//
// There is no tap-to-lock or hands-free mode. The previous "tap = lock,
// hold = release-to-send" split confused users because natural taps
// kept catching the threshold edge. The single hold gesture is
// unambiguous and matches what most users expect from a messaging
// app's mic button. It also mirrors the SOSButton's hold-to-confirm
// behaviour (`components/sos/SOSButton.tsx`) — same conceptual model.
//
// Why document-level listeners while recording, instead of the
// usual React pointerup on the button:
//
//   On press, the UI swaps from <button> (idle) to <div> (recording
//   bar). The button unmounts. A pointer that was captured by the
//   button is dropped along with it, so subsequent pointermove /
//   pointerup events never reach the React handlers we attached to
//   the bar. That is exactly the bug the user reported ("I let go but
//   it keeps recording"). We sidestep it by binding pointermove /
//   pointerup to `document` for the lifetime of the recording, so
//   release is detected regardless of which element is under the
//   finger at the time. Refs carry mutable state so the document
//   listener always sees the latest values.

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Trash2 } from "lucide-react";
import { useVoiceRecorder, type RecorderResult } from "@/features/chat/useVoiceRecorder";

interface Props {
  // Fires once a recording is finalised — either via release-to-send
  // or auto-stop at the 2-minute cap. Caller is responsible for
  // shipping it through the send pipeline.
  onSend: (file: File, duration: number) => void;
  // Fires when recording is cancelled (slide-to-cancel or permission
  // denial). UI returns to the idle text input. No file is produced.
  onCancel: () => void;
  // Fires whenever recording starts / stops. Parent uses this to hide
  // its own input affordances (textarea, attach button) while the bar
  // takes over the input row.
  onActiveChange?: (active: boolean) => void;
  // Called repeatedly while a recording is active so the parent can
  // broadcast "recording" presence to the other participant. The
  // parent throttles, so spamming this is fine.
  onRecordingTick?: () => void;
  // Auto-stop at this many seconds. Default 120 (2 min). Hard cap —
  // the recorder enforces it; UI just updates the displayed timer.
  maxSeconds?: number;
  // Surface a toast / similar when the recording is cut off because
  // the cap was hit.
  onAutoStopped?: () => void;
}

// How far the user has to drag left to count as a cancel during a
// hold-recording. Below this they probably just shifted their finger.
const CANCEL_DRAG_PX = 80;

export function VoiceRecorderBar({
  onSend,
  onCancel,
  onActiveChange,
  onRecordingTick,
  maxSeconds = 120,
  onAutoStopped,
}: Props) {
  // -----------------------------------------------------
  // Recorder state via the hook
  // -----------------------------------------------------
  // Auto-stop sends the recording — that's the natural user
  // expectation when the cap is hit (you spoke for 2 minutes; you
  // meant to send a 2-minute message).
  const recorder = useVoiceRecorder({
    maxSeconds,
    onAutoStop: (r) => {
      onAutoStopped?.();
      finalize(r);
    },
  });

  // -----------------------------------------------------
  // UI mode: idle (mic button only) or recording (full bar with
  // timer + amplitude + slide-to-cancel hint). No locked / hands-free
  // mode — see top comment.
  // -----------------------------------------------------
  const [mode, setMode] = useState<"idle" | "recording">("idle");
  const [dragX, setDragX] = useState(0);

  // Refs that the document-level pointer listeners read from. State
  // alone wouldn't work — the listener closure captures the value at
  // bind-time and never sees subsequent updates, which is how the
  // previous version was misreading the slide distance.
  const startXRef = useRef(0);
  const dragXRef = useRef(0);
  const modeRef = useRef<"idle" | "recording">("idle");

  // -----------------------------------------------------
  // Helper: package the recorder result as a File and hand off.
  // -----------------------------------------------------
  const finalize = useCallback(
    (r: RecorderResult) => {
      const ext = extFor(r.mimeType);
      const name = `voice_${Date.now()}.${ext}`;
      const file = new File([r.blob], name, { type: r.mimeType });
      onSend(file, r.duration);
      setMode("idle");
      modeRef.current = "idle";
      setDragX(0);
      dragXRef.current = 0;
    },
    [onSend]
  );

  // Tick the recording broadcast while we're recording.
  useEffect(() => {
    if (recorder.state !== "recording") return;
    onRecordingTick?.();
    const id = setInterval(() => onRecordingTick?.(), 1200);
    return () => clearInterval(id);
  }, [recorder.state, onRecordingTick]);

  // Notify parent on active/inactive transitions so it can hide its
  // own input affordances when we expand to fill the row.
  useEffect(() => {
    onActiveChange?.(mode !== "idle");
  }, [mode, onActiveChange]);

  // -----------------------------------------------------
  // Document-level gesture: only mounted while recording.
  //
  // pointermove tracks horizontal drag distance for the
  // slide-to-cancel visual. pointerup decides whether the user
  // crossed the cancel threshold (discard) or simply released
  // (send). Both are bound to `document` rather than the bar so we
  // continue to receive events even though the original press target
  // (the mic button) has been unmounted.
  // -----------------------------------------------------
  useEffect(() => {
    if (mode !== "recording") return;

    const onMove = (e: PointerEvent) => {
      if (modeRef.current !== "recording") return;
      // Only leftward drag counts toward cancel. Right of the start
      // position stays at 0 (no visual shift).
      const dx = Math.min(0, e.clientX - startXRef.current);
      dragXRef.current = dx;
      setDragX(dx);
    };

    const finish = async (cancel: boolean) => {
      if (modeRef.current !== "recording") return;
      // Set mode immediately so a second release event can't double-
      // fire send + cancel. The recorder hook is idempotent but the
      // UI state isn't.
      modeRef.current = "idle";
      if (cancel) {
        await recorder.cancel().catch(() => {});
        onCancel();
        setMode("idle");
        setDragX(0);
        dragXRef.current = 0;
        return;
      }
      try {
        const r = await recorder.stop();
        finalize(r);
      } catch (err) {
        console.warn("[voice] release-to-send failed", err);
        onCancel();
        setMode("idle");
        setDragX(0);
        dragXRef.current = 0;
      }
    };

    const onUp = () => {
      const cancel = dragXRef.current < -CANCEL_DRAG_PX;
      void finish(cancel);
    };

    // pointercancel covers cases where the browser revokes the
    // gesture mid-flight (e.g. switching apps on Capacitor). Treat
    // like release-without-drag — send what we have so the user
    // doesn't lose the recording entirely.
    const onCancelEvt = () => {
      void finish(false);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancelEvt);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancelEvt);
    };
  }, [mode, recorder, finalize, onCancel]);

  // -----------------------------------------------------
  // Press handler on the mic button — only fires in idle mode. The
  // moment we flip to recording, the button unmounts and the document
  // listeners above take over for the rest of the gesture.
  // -----------------------------------------------------
  const handleHoldStart = useCallback(
    (clientX: number) => {
      if (modeRef.current !== "idle") return;
      startXRef.current = clientX;
      dragXRef.current = 0;
      modeRef.current = "recording";
      setMode("recording");
      setDragX(0);
      void recorder.start();
    },
    [recorder]
  );

  // -----------------------------------------------------
  // Permission-denied path: surface and bail back to idle.
  // -----------------------------------------------------
  useEffect(() => {
    if (!recorder.permissionDenied) return;
    onCancel();
    modeRef.current = "idle";
    setMode("idle");
    setDragX(0);
    dragXRef.current = 0;
  }, [recorder.permissionDenied, onCancel]);

  // -----------------------------------------------------
  // Render
  // -----------------------------------------------------
  if (mode === "idle") {
    return (
      <button
        type="button"
        // Pointer events for unified mouse/touch input. The handler
        // ONLY starts the gesture — release / move are caught by the
        // document listeners installed in the recording effect above.
        onPointerDown={(e) => {
          e.preventDefault();
          handleHoldStart(e.clientX);
        }}
        className="shrink-0 w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center active:scale-90 transition-transform"
        aria-label="Hold to record"
      >
        <Mic className="w-4 h-4" />
      </button>
    );
  }

  // Recording mode: pill-shaped surface with timer + amplitude pulse
  // + slide-to-cancel hint. Pointer-events:none so document-level
  // handlers stay in charge (the user is still holding their finger
  // somewhere — the bar shouldn't intercept it).
  const draggedFar = dragX < -CANCEL_DRAG_PX;
  return (
    <div
      className="flex-1 flex items-center gap-2 h-10 rounded-2xl bg-red-500/15 border border-red-500/40 px-3 peja-bar-expand-from-right pointer-events-none"
      aria-live="polite"
    >
      <RecordingPulse amplitude={recorder.amplitude} />
      <span className="text-sm font-medium text-red-300 tabular-nums">
        {formatTime(recorder.duration)}
      </span>
      {/* Slide-to-cancel hint. The whole label tracks the user's
          horizontal drag so the gesture feels physical. Past the
          threshold the copy flips to "Release to cancel" in a bolder
          red so the user knows what releasing now would do. */}
      <span
        className={`flex-1 text-right text-xs inline-flex items-center justify-end gap-1.5 ${
          draggedFar ? "text-red-300 font-semibold" : "text-dark-300"
        }`}
        style={{ transform: `translateX(${dragX}px)` }}
      >
        {draggedFar ? (
          <>
            <Trash2 className="w-3.5 h-3.5" />
            <span>Release to cancel</span>
          </>
        ) : (
          <span>← Slide to cancel</span>
        )}
      </span>
    </div>
  );
}

// Pulsing red dot whose scale tracks mic amplitude. Pure visual.
function RecordingPulse({ amplitude }: { amplitude: number }) {
  // Scale ranges 0.7..1.4 so even silence has a visible idle pulse.
  const scale = 0.7 + Math.min(1, amplitude) * 0.7;
  return (
    <span
      aria-hidden
      className="shrink-0 w-2.5 h-2.5 rounded-full bg-red-500"
      style={{
        transform: `scale(${scale.toFixed(2)})`,
        transition: "transform 0.08s linear",
      }}
    />
  );
}

function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a"))
    return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}
