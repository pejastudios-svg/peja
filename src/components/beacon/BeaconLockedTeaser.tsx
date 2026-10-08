"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { authFetchJson } from "@/lib/authFetch";
import { BeaconIllustration } from "./BeaconIllustration";

/**
 * What the Beacon section looks like before an account has the code.
 *
 * Shows what the device is and what it does, because this screen is doing
 * two jobs: holding the door shut, and explaining to the people who reach
 * it why they would want to be let in.
 *
 * The way in is a long press on the lock, and it is written down NOWHERE
 * on this screen. A hint would make the gate decorative. The only
 * concession to usability is the ring, which starts filling well after any
 * accidental press would have ended, so it confirms the gesture for
 * someone who already knows it without advertising it to anyone else.
 */
const HOLD_MS = 5000;
// Long enough that a tap, a scroll or a stray thumb never reaches it.
const REVEAL_PROGRESS_AFTER_MS = 900;

export function BeaconLockedTeaser({
  onUnlocked,
  onExit,
}: {
  onUnlocked: () => void;
  onExit: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [askOpen, setAskOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startedAt = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const stopHold = useCallback(() => {
    startedAt.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  }, []);

  const tick = useCallback(() => {
    if (startedAt.current == null) return;
    const elapsed = Date.now() - startedAt.current;
    if (elapsed >= HOLD_MS) {
      stopHold();
      setError(null);
      setCode("");
      setAskOpen(true);
      return;
    }
    setProgress(Math.min(1, elapsed / HOLD_MS));
    raf.current = requestAnimationFrame(tick);
  }, [stopHold]);

  const startHold = useCallback(() => {
    if (askOpen) return;
    startedAt.current = Date.now();
    raf.current = requestAnimationFrame(tick);
  }, [askOpen, tick]);

  useEffect(() => () => stopHold(), [stopHold]);

  const submit = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await authFetchJson("/api/beacon/unlock", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        setError(data?.error || "That code is not correct");
        setCode("");
        return;
      }
      setAskOpen(false);
      onUnlocked();
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // Shown only once the press has outlasted anything accidental.
  const showRing = progress * HOLD_MS > REVEAL_PROGRESS_AFTER_MS;

  return (
    <div className="min-h-screen bg-dark-950 px-5 py-8 flex flex-col">
      <button
        onClick={onExit}
        className="self-start text-sm text-dark-400 hover:text-dark-200 transition-ui mb-6"
      >
        Back
      </button>

      <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full">
        {/* The device, out of focus. Enough to see there is something here. */}
        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none select-none scale-[0.78] origin-center opacity-60"
            style={{ filter: "blur(9px)" }}
          >
            <BeaconIllustration />
          </div>

          <button
            type="button"
            aria-label="Locked"
            onPointerDown={startHold}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            onContextMenu={(e) => e.preventDefault()}
            className="absolute inset-0 m-auto w-20 h-20 rounded-full flex items-center justify-center active:scale-[0.97] transition-transform"
            style={{
              background: "var(--glass-strong-bg)",
              border: "1px solid var(--glass-border-strong)",
              boxShadow: "var(--glass-shadow-strong)",
              touchAction: "none",
            }}
          >
            {showRing && (
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50" cy="50" r="46" fill="none"
                  stroke="var(--peja-btn-outline)" strokeWidth="4"
                  strokeDasharray={2 * Math.PI * 46}
                  strokeDashoffset={2 * Math.PI * 46 * (1 - progress)}
                  strokeLinecap="round"
                />
              </svg>
            )}
            <Lock className="w-8 h-8 beacon-accent-text" />
          </button>
        </div>

        <h1 className="text-2xl font-bold text-dark-50 mt-8 text-center">Peja Beacon</h1>

        {/* Second person throughout: this is about the reader, not about a
            product. And it closes on what the Beacon replaces rather than
            who it is for, so nobody reads themselves out of it. */}
        <div className="mt-4 space-y-3.5 text-[15px] text-dark-300 leading-relaxed text-center">
          <p>
            A small wearable that works entirely on its own. No phone, no app,
            no screen. It carries its own SIM.
          </p>
          <p>
            Press the button and it calls for help, alerts the people you
            trust, and puts your live location on their map.
          </p>
          <p>
            It keeps sharing your location for as long as it is switched on,
            so your people always know where you are, not only in an
            emergency.
          </p>
          <p>
            It watches for the things you would never think to report: when
            you leave a safe area, when you stay still too long, when your
            battery is running flat.
          </p>
          <p className="text-dark-200 font-medium pt-1">
            Close protection used to mean a vehicle and a team. Now it fits in
            your pocket.
          </p>
        </div>
      </div>

      <Modal isOpen={askOpen} onClose={() => setAskOpen(false)} title="Enter code">
        <div className="space-y-4">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 12));
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Code"
            className="w-full px-4 py-3 glass-input text-xl tracking-[0.4em] text-center font-mono"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAskOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={busy || !code.trim()}>
              {busy ? "Checking..." : "Unlock"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
