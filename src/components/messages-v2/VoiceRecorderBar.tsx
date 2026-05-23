"use client";

// Voice-note input bar. WhatsApp-style hold-to-record:
//
//   • Press and HOLD the mic button to start recording.
//   • Release (without dragging) to stop and send.
//   • While still holding, drag finger LEFT past the cancel threshold
//     to discard the recording on release.
//
// There is no tap-to-lock or hands-free mode any more. The previous
// "tap = lock, hold = release-to-send" split confused users because a
// natural tap kept catching the threshold edge. The single hold
// gesture is unambiguous and matches what most users expect from a
// messaging app's mic button.
//
// Cancel-via-drag is visually progressive: a "← Slide to cancel" hint
// is always visible during recording, and once the user crosses the
// halfway point of the drag the hint flips to "Release to cancel" in
// red to telegraph what releasing now would do.

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
  const startXRef = useRef(0);

  // -----------------------------------------------------
  // Helper: package the recorder result as a File and hand off.
  // The pipeline expects a File with a sensible extension; we derive
  // it from the recorder's reported mimeType.
  // -----------------------------------------------------
  const finalize = useCallback(
    (r: RecorderResult) => {
      const ext = extFor(r.mimeType);
      const name = `voice_${Date.now()}.${ext}`;
      const file = new File([r.blob], name, { type: r.mimeType });
      onSend(file, r.duration);
      setMode("idle");
      setDragX(0);
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
  // Press handlers (mouse + touch unified)
  // -----------------------------------------------------
  const onPointerDown = useCallback(
    async (e: React.PointerEvent<HTMLButtonElement>) => {
      if (mode !== "idle") return;
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      startXRef.current = e.clientX;
      setMode("recording");
      setDragX(0);
      // Kick off recording. Don't await — the UI should already show
      // the recording bar while the mic spins up to make the press
      // feel instantaneous.
      void recorder.start();
    },
    [mode, recorder]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (mode !== "recording") return;
      // Only track leftward drift (dragX <= 0). The user dragging
      // RIGHT shouldn't visually shift the bar — that's not a
      // meaningful gesture in this UI.
      const dx = Math.min(0, e.clientX - startXRef.current);
      setDragX(dx);
    },
    [mode]
  );

  const onPointerUp = useCallback(
    async (e: React.PointerEvent) => {
      if (mode !== "recording") return;
      (e.target as Element).releasePointerCapture?.(e.pointerId);

      const draggedFarEnough = dragX < -CANCEL_DRAG_PX;

      if (draggedFarEnough) {
        // Slide-to-cancel: discard the recording.
        await recorder.cancel();
        onCancel();
        setMode("idle");
        setDragX(0);
        return;
      }

      // Normal release: stop + send.
      try {
        const r = await recorder.stop();
        finalize(r);
      } catch (err) {
        console.warn("[voice] release-to-send failed", err);
        onCancel();
        setMode("idle");
        setDragX(0);
      }
    },
    [mode, dragX, recorder, onCancel, finalize]
  );

  // -----------------------------------------------------
  // Permission-denied path: surface and bail back to idle.
  // -----------------------------------------------------
  useEffect(() => {
    if (!recorder.permissionDenied) return;
    onCancel();
    setMode("idle");
  }, [recorder.permissionDenied, onCancel]);

  // -----------------------------------------------------
  // Render
  // -----------------------------------------------------
  if (mode === "idle") {
    return (
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setMode("idle");
          setDragX(0);
          recorder.cancel();
        }}
        className="shrink-0 w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center active:scale-90 transition-transform"
        aria-label="Hold to record"
      >
        <Mic className="w-4 h-4" />
      </button>
    );
  }

  // Recording mode: pill-shaped surface with timer + amplitude pulse
  // + slide-to-cancel hint. Drag tracks the user's finger so they get
  // immediate feedback that the gesture is being received.
  const draggedFar = dragX < -CANCEL_DRAG_PX;
  return (
    <div
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="flex-1 flex items-center gap-2 h-10 rounded-2xl bg-red-500/15 border border-red-500/40 px-3 peja-bar-expand-from-right"
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
          draggedFar
            ? "text-red-300 font-semibold"
            : "text-dark-300"
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
