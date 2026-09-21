"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { useToast } from "@/context/ToastContext";
import { tallySheet, type ElectionCandidate, type Sheet } from "@/lib/elections";
import { useAuth } from "@/context/AuthContext";
import { dispatchOrQueue, newOutboxId } from "@/lib/outbox";

// MVP tallying: the sheet photo on top, the candidates below, a number
// box per candidate. Submitting when a tally already exists is a
// CORRECTION: the old entry stays in the sheet's public history and the
// new one takes over the count. Nothing is ever edited in place.

export function TallySheetModal({
  isOpen,
  onClose,
  electionId,
  sheet,
  candidates,
  pin,
  onTallied,
}: {
  isOpen: boolean;
  onClose: () => void;
  electionId: string;
  sheet: Sheet;
  candidates: ElectionCandidate[];
  pin: string;
  onTallied: () => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const live = sheet.tallies.find((t) => !t.superseded);
  const [figures, setFigures] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of candidates) {
      init[c.id] = live?.figures?.[c.id] != null ? String(live.figures[c.id]) : "";
    }
    return init;
  });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const submit = async () => {
    const clean: Record<string, number> = {};
    for (const [cid, v] of Object.entries(figures)) {
      if (v.trim() === "") continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        toast.warning("Votes must be whole numbers");
        return;
      }
      clean[cid] = n;
    }
    if (Object.keys(clean).length === 0) {
      toast.warning("Enter at least one figure");
      return;
    }
    setBusy(true);

    // Where the tallying phone is, best effort, never blocking.
    let deviceLat: number | undefined;
    let deviceLng: number | undefined;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 2500,
          maximumAge: 60000,
        }),
      );
      deviceLat = pos.coords.latitude;
      deviceLng = pos.coords.longitude;
    } catch {}

    const queueOffline = async () => {
      if (!user?.id) return false;
      try {
        await dispatchOrQueue(user.id, {
          id: newOutboxId(),
          kind: "election-tally",
          queued_at: Date.now(),
          attempts: 0,
          last_error: null,
          payload: {
            election_id: electionId,
            upload_id: sheet.id,
            figures: clean,
            note: note.trim() || null,
            pin,
            device_lat: deviceLat ?? null,
            device_lng: deviceLng ?? null,
            triggered_at: new Date().toISOString(),
          },
        });
        return true;
      } catch {
        return false;
      }
    };

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const queued = await queueOffline();
      toast.info(
        queued
          ? "No connection. The tally is queued and sends by itself when the network returns."
          : "Could not queue the tally. Try again.",
      );
      if (queued) onClose();
      setBusy(false);
      return;
    }

    try {
      const { corrected } = await tallySheet(electionId, {
        pin,
        uploadId: sheet.id,
        figures: clean,
        note: note.trim() || undefined,
        deviceLat,
        deviceLng,
      });
      toast.success(corrected ? "Tally corrected. The old entry stays in history." : "Tally recorded.");
      onTallied();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save the tally";
      if (/network|fetch|failed \(5|load/i.test(msg)) {
        const queued = await queueOffline();
        if (queued) {
          toast.info("Connection is rough. The tally is queued and sends by itself.");
          onClose();
          setBusy(false);
          return;
        }
      }
      toast.warning(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : onClose} title={live ? "Correct tally" : "Tally this sheet"}>
      <div className="space-y-4">
        {sheet.photoUrl && (
          <button
            onClick={() => setZoomed(true)}
            className="block w-full rounded-2xl overflow-hidden border border-[var(--glass-border)] active:scale-[0.99] transition-transform"
            aria-label="Expand the photo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sheet.photoUrl} alt="Result sheet" className="w-full max-h-72 object-contain bg-black" />
          </button>
        )}
        <p className="text-xs text-dark-500">
          {sheet.lga}, {sheet.state}
          {sheet.pollingUnit ? `, ${sheet.pollingUnit}` : ""} · uploaded by {sheet.uploaderName}
        </p>

        {live && (
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
            <p className="text-xs text-dark-300">
              This sheet already has a tally by {live.talliedBy}. Submitting
              again corrects it in the open: the old entry stays visible in
              the sheet&apos;s history.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {candidates.map((c) => (
            <div key={c.id} className="flex items-center gap-3">
              <AvatarImage
                src={c.photo_url}
                wrapperClassName="w-8 h-8 rounded-full bg-primary-600/20 overflow-hidden shrink-0 flex items-center justify-center"
                fallback={<span className="text-xs font-bold text-primary-400">{c.name[0]}</span>}
              />
              <span className="flex-1 text-sm text-dark-100 truncate">{c.name}</span>
              <input
                inputMode="numeric"
                value={figures[c.id] ?? ""}
                onChange={(e) =>
                  setFigures((prev) => ({ ...prev, [c.id]: e.target.value.replace(/\D/g, "").slice(0, 8) }))
                }
                placeholder="0"
                className="w-24 glass-input rounded-xl px-3 text-right text-sm tabular-nums text-dark-100 placeholder:text-dark-600"
              />
            </div>
          ))}
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder={live ? "Why the correction? (shown publicly)" : "Note (optional, shown publicly)"}
          className="w-full glass-input rounded-xl px-4 text-sm text-dark-100 placeholder:text-dark-500"
        />

        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-3.5 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.97] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy ? <PejaSpinner className="w-4 h-4" /> : <Calculator className="w-4 h-4" />}
          {live ? "Submit correction" : "Submit tally"}
        </button>
      </div>

      {zoomed && sheet.photoUrl && (
        <ImageLightbox isOpen onClose={() => setZoomed(false)} imageUrl={sheet.photoUrl} />
      )}
    </Modal>
  );
}
