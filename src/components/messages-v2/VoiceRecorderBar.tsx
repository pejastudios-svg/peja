"use client";

// Input-bar UI for recording voice notes. Sits in place of the
// textarea + send button while a recording is in progress.
//
// Two ways to start a recording (matches user request):
//
//   1. HOLD the mic button:
//        • Press and hold → recording starts.
//        • Drag finger LEFT past the cancel threshold → recording is
//          cancelled when released.
//        • Release without dragging → recording stops and sends.
//
//   2. TAP the mic button:
//        • Short press (released before kRecordHoldThresholdMs) →
//          enters "locked" recording mode. The user can record
//          hands-free and tap explicit buttons to either cancel or
//          send when done.
//
// Both modes share the same recorder (useVoiceRecorder) underneath;
// only the UI affordances differ.

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Trash2, Send, Lock, LockOpen } from "lucide-react";
import { useVoiceRecorder, type RecorderResult } from "@/features/chat/useVoiceRecorder";

interface Props {
  // Fires once a recording is finalised — either via release-to-send,
  // tap-send-from-locked, or auto-stop at the 2-minute cap. Caller is
  // responsible for actually shipping it through the send pipeline.
  onSend: (file: File, duration: number) => void;
  // Fires when recording is cancelled (slide-to-cancel, explicit
  // cancel tap, or permission denial). UI returns to the idle text
  // input. No file is produced.
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

// Hold/tap threshold: a press that releases before this counts as
// a "tap" → locked mode. After this it counts as "hold" → release to
// send. 250ms was too tight — natural taps regularly exceeded it,
// which made the tap-to-lock affordance feel unreliable. 400ms tracks
// WhatsApp's behaviour and gives users meaningful headroom.
const HOLD_THRESHOLD_MS = 400;

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
  // UI mode: idle (showing only the mic button) vs hold-recording
  // (button is being pressed) vs locked-recording (hands-free mode).
  // -----------------------------------------------------
  const [mode, setMode] = useState<"idle" | "hold" | "locked">("idle");
  const [dragX, setDragX] = useState(0);
  // While in "hold" mode but BEFORE the HOLD_THRESHOLD_MS elapses we
  // don't yet know if this is going to be a tap (→ locked mode) or a
  // hold (→ release-to-send + slide-to-cancel). The "Slide to cancel"
  // hint + padlock are misleading during that window — the user might
  // be lifting their finger any moment to commit a tap. So we flip
  // `holdConfirmed` to true only once the threshold passes, and the
  // bar swaps from a tap-friendly trash hint into the slide-to-cancel
  // UI on the same beat.
  const [holdConfirmed, setHoldConfirmed] = useState(false);
  const holdConfirmTimerRef = useRef<number | null>(null);
  const pressedAtRef = useRef(0);
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
      pressedAtRef.current = Date.now();
      startXRef.current = e.clientX;
      setMode("hold");
      setDragX(0);
      setHoldConfirmed(false);
      // Confirm "this is a hold" after the threshold so the bar UI
      // can swap from the tap-friendly state into the slide-to-cancel
      // state. If pointer-up fires first we cancel this timer.
      if (holdConfirmTimerRef.current !== null) {
        window.clearTimeout(holdConfirmTimerRef.current);
      }
      holdConfirmTimerRef.current = window.setTimeout(() => {
        setHoldConfirmed(true);
        holdConfirmTimerRef.current = null;
      }, HOLD_THRESHOLD_MS);
      // Kick off recording. Don't await — the UI should already be in
      // hold mode while the mic spins up to make the press feel
      // instantaneous.
      void recorder.start();
    },
    [mode, recorder]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (mode !== "hold") return;
      const dx = Math.min(0, e.clientX - startXRef.current); // only left
      setDragX(dx);
    },
    [mode]
  );

  const onPointerUp = useCallback(
    async (e: React.PointerEvent) => {
      // If we're in locked mode, the pointer-up after a fresh press
      // is just letting go of the explicit Send button (handled by
      // that button's own onClick). Nothing to do here.
      if (mode !== "hold") return;
      (e.target as Element).releasePointerCapture?.(e.pointerId);

      // Always cancel the pending hold-confirm timer — we now know
      // whether this was a tap or a hold based on the actual elapsed
      // time, so the deferred flag doesn't need to fire.
      if (holdConfirmTimerRef.current !== null) {
        window.clearTimeout(holdConfirmTimerRef.current);
        holdConfirmTimerRef.current = null;
      }
      setHoldConfirmed(false);

      const held = Date.now() - pressedAtRef.current;
      const draggedFarEnough = dragX < -CANCEL_DRAG_PX;

      // Tap (not a hold): transition to locked mode and keep
      // recording. User finishes via the Send button.
      if (held < HOLD_THRESHOLD_MS && !draggedFarEnough) {
        setMode("locked");
        setDragX(0);
        return;
      }

      // Slide-to-cancel: discard the recording.
      if (draggedFarEnough) {
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

  // Explicit cancel from locked mode.
  const onLockedCancel = useCallback(async () => {
    await recorder.cancel();
    onCancel();
    setMode("idle");
  }, [recorder, onCancel]);

  // Explicit send from locked mode.
  const onLockedSend = useCallback(async () => {
    try {
      const r = await recorder.stop();
      finalize(r);
    } catch (err) {
      console.warn("[voice] locked-send failed", err);
      onCancel();
      setMode("idle");
    }
  }, [recorder, onCancel, finalize]);

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
          if (holdConfirmTimerRef.current !== null) {
            window.clearTimeout(holdConfirmTimerRef.current);
            holdConfirmTimerRef.current = null;
          }
          setHoldConfirmed(false);
          setMode("idle");
          setDragX(0);
          recorder.cancel();
        }}
        className="shrink-0 w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center active:scale-90 transition-transform"
        aria-label="Hold to record, tap to lock"
      >
        <Mic className="w-4 h-4" />
      </button>
    );
  }

  // Hold mode — pill-shaped recording surface with timer + amplitude
  // ring + slide-to-cancel hint. Spans the input area so the user has
  // somewhere to drag from. The whole bar animates IN from the mic
  // position on the right (peja-bar-expand-from-right) so it reads as
  // "the mic pulled out into a recording surface" rather than a
  // hard-cut swap.
  if (mode === "hold") {
    const draggedFar = dragX < -CANCEL_DRAG_PX;
    // The padlock animates open as the user slides away from it
    // (toward the cancel side, dragX < 0). We cross-fade two icons
    // sharing the same slot so the swap is smooth — no "icon
    // missing" frame between Lock and LockOpen. The visual midpoint
    // is half the cancel threshold so feedback starts as soon as
    // the user moves, well before they commit to cancel.
    const unlockProgress = Math.min(1, Math.max(0, -dragX / CANCEL_DRAG_PX));
    const padlockUnlocked = unlockProgress > 0.35;
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
        {/* During the pre-threshold press window the user might still
            be intending to tap-to-lock — we don't yet know which mode
            they want. Showing the slide-to-cancel hint here was
            misleading (it advertised a behaviour that doesn't apply
            yet) and the previous "Lift to lock, then [trash] to
            cancel" hint flashed on every tap, which made taps feel
            like they triggered the hold UI. Empty during the window
            is the right answer: timer + pulse is enough, and the bar
            still telegraphs "recording" without instructing the user
            to do something that may not apply. Slide hint + padlock
            appear only once the hold is confirmed. */}
        {holdConfirmed && (
          <>
            <span
              className={`flex-1 text-right text-xs ${
                draggedFar ? "text-red-300 font-semibold" : "text-dark-300"
              }`}
              style={{ transform: `translateX(${dragX}px)` }}
            >
              {draggedFar ? "Release to cancel" : "← Slide to cancel"}
            </span>
            <span
              className="relative w-3.5 h-3.5 shrink-0"
              aria-label="Lift to lock"
            >
              <Lock
                className="absolute inset-0 w-3.5 h-3.5 text-dark-400 transition-opacity duration-150"
                style={{ opacity: padlockUnlocked ? 0 : 1 }}
              />
              <LockOpen
                className="absolute inset-0 w-3.5 h-3.5 text-red-300 transition-opacity duration-150"
                style={{
                  opacity: padlockUnlocked ? 1 : 0,
                  // Small upward float on the unlocked state so the
                  // metaphor lands — the shackle "pops" up off the
                  // body as it opens.
                  transform: padlockUnlocked
                    ? "translateY(-1px)"
                    : "translateY(0)",
                  transition: "opacity 150ms ease, transform 150ms ease",
                }}
              />
            </span>
          </>
        )}
      </div>
    );
  }

  // Locked mode — hands-free. Cancel on the left, mic + timer in the
  // middle, send on the right.
  return (
    <div className="flex-1 flex items-center gap-2 h-10 rounded-2xl bg-red-500/15 border border-red-500/40 px-2 peja-bar-expand-from-right">
      <button
        type="button"
        onClick={onLockedCancel}
        className="shrink-0 w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center active:scale-90 transition-transform"
        aria-label="Cancel recording"
      >
        <Trash2 className="w-4 h-4 text-red-300" />
      </button>
      <RecordingPulse amplitude={recorder.amplitude} />
      <span className="flex-1 text-sm font-medium text-red-300 tabular-nums">
        {formatTime(recorder.duration)}
      </span>
      <button
        type="button"
        onClick={onLockedSend}
        className="shrink-0 w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center active:scale-90 transition-transform"
        aria-label="Send voice note"
      >
        <Send className="w-3.5 h-3.5" />
      </button>
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
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
  return "webm";
}
