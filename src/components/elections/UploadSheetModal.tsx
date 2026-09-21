"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronDown, CloudUpload, MapPin, RefreshCw, Trash2, TriangleAlert, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { useToast } from "@/context/ToastContext";
import { NIGERIA_LGAS, NIGERIA_STATES_LIST } from "@/lib/nigeriaLgas";
import { uploadSheet } from "@/lib/elections";
import { useAuth } from "@/context/AuthContext";
import { dispatchOrQueue, newOutboxId } from "@/lib/outbox";
import { putDraftBlob } from "@/lib/postDraftBlobs";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/mediaCompression";
import { ImageLightbox } from "@/components/ui/ImageLightbox";

// Upload a photographed result sheet. The free/committed line is drawn in
// the UI exactly where it is drawn on the server: while the photo sits in
// the preview it can be retaken or discarded as often as needed; the
// moment Upload succeeds it is permanent, and the confirm step says so in
// plain words before allowing it.

export function UploadSheetModal({
  isOpen,
  onClose,
  electionId,
  pin,
  onUploaded,
  defaultState,
  defaultLga,
}: {
  isOpen: boolean;
  onClose: () => void;
  electionId: string;
  pin: string;
  onUploaded: () => void;
  /** Prefill from wherever the browse view is currently scoped. */
  defaultState?: string | null;
  defaultLga?: string | null;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  // The uploader is almost always uploading for the place they are
  // looking at, so the browse scope arrives as the default. Still
  // editable: scope is a starting point, not a cage.
  const [state, setState] = useState(defaultState || "");
  const [lga, setLga] = useState(defaultLga || "");
  const [zoomed, setZoomed] = useState(false);
  const [pollingUnit, setPollingUnit] = useState("");
  const [photo, setPhoto] = useState<string | null>(null); // data URL
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Silent pre-upload, exactly the /create pattern: the moment the shot
  // is taken it compresses and streams to temp/ storage in the
  // background while the uploader is still picking the LGA. Commit then
  // just points the server at the staged file (instant), instead of
  // pushing megabytes over an election-day network at the moment of
  // truth. Retakes delete their staged file; anything missed is swept by
  // the 24h temp/ cron.
  type PreUpload =
    | { status: "uploading" }
    | { status: "done"; tempPath: string }
    | { status: "failed" };
  const [preUpload, setPreUpload] = useState<PreUpload | null>(null);
  // Position, grabbed the moment the modal opens. "pending" while the
  // GPS warms up; "ok" with coords; "none" if denied or timed out. The
  // uploader sees which of these the record will carry BEFORE uploading;
  // missing location is allowed but never silent again.
  const [gps, setGps] = useState<
    | { status: "pending" }
    | { status: "ok"; lat: number; lng: number; accuracyM: number }
    | { status: "none" }
  >({ status: "pending" });
  useEffect(() => {
    if (!isOpen) return;
    let stop = false;
    if (!navigator.geolocation) {
      setGps({ status: "none" });
      return;
    }
    setGps({ status: "pending" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!stop)
          setGps({
            status: "ok",
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
          });
      },
      () => {
        if (!stop) setGps({ status: "none" });
      },
      { timeout: 10000, maximumAge: 30000, enableHighAccuracy: true },
    );
    return () => {
      stop = true;
    };
  }, [isOpen]);
  // The path staged for the CURRENT photo; also what unmount cleans up.
  const stagedRef = useRef<string | null>(null);
  const committedRef = useRef(false);

  const discardStaged = () => {
    const p = stagedRef.current;
    stagedRef.current = null;
    if (p) supabase.storage.from("media").remove([p]).catch(() => {});
  };

  // Closing without committing abandons the draft: staged file removed,
  // like /create's unmount cleanup. The cron is only the backstop.
  useEffect(() => {
    return () => {
      if (!committedRef.current) discardStaged();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPhoto = async (file: File) => {
    // A new shot replaces the old draft, on screen and in storage.
    discardStaged();
    setPreUpload({ status: "uploading" });

    // Compress first (client canvas, keeps figures readable), preview
    // immediately, then stage in the background.
    let toStage: File = file;
    try {
      if (file.size > 500 * 1024) toStage = await compressImage(file);
    } catch {}

    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(toStage);

    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("no session");
      const ext = toStage.type.includes("png") ? "png" : toStage.type.includes("webp") ? "webp" : "jpg";
      const tempPath = `temp/${auth.user.id}-${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      const { error } = await supabase.storage
        .from("media")
        .upload(tempPath, toStage, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      stagedRef.current = tempPath;
      setPreUpload({ status: "done", tempPath });
    } catch {
      // No staging (offline, storage hiccup): the commit falls back to
      // inline bytes or the outbox queue. Never a blocker.
      setPreUpload({ status: "failed" });
    }
  };

  const doUpload = async () => {
    if (!photo || !state || !lga) return;
    setBusy(true);
    // The fix acquired when the modal opened; one quick retry if it was
    // still warming up. Refusal is allowed (uploads must not fail in a
    // dead spot), but the status line above the button already told the
    // uploader exactly what the record will carry.
    let coords: { deviceLat?: number; deviceLng?: number; deviceAccuracyM?: number } = {};
    if (gps.status === "ok") {
      coords = { deviceLat: gps.lat, deviceLng: gps.lng, deviceAccuracyM: gps.accuracyM };
    } else {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 6000,
            maximumAge: 30000,
            enableHighAccuracy: true,
          }),
        );
        coords = {
          deviceLat: pos.coords.latitude,
          deviceLng: pos.coords.longitude,
          deviceAccuracyM: pos.coords.accuracy,
        };
      } catch {}
    }

    // Queue-through-outbox path: polling units have dead networks on
    // election day, so offline capture MUST work. The photo bytes go to
    // IndexedDB and the action replays exactly like /create posts do.
    const queueOffline = async () => {
      if (!user?.id) return false;
      try {
        const itemId = newOutboxId();
        const blob = await (await fetch(photo)).blob();
        await putDraftBlob(itemId, "sheet", blob);
        await dispatchOrQueue(user.id, {
          id: itemId,
          kind: "election-upload",
          queued_at: Date.now(),
          attempts: 0,
          last_error: null,
          payload: {
            election_id: electionId,
            state,
            lga,
            polling_unit: pollingUnit.trim() || null,
            pin,
            device_lat: coords.deviceLat ?? null,
            device_lng: coords.deviceLng ?? null,
            device_accuracy_m: coords.deviceAccuracyM ?? null,
            draft_id: itemId,
            media_id: "sheet",
            triggered_at: new Date().toISOString(),
          },
        });
        return true;
      } catch {
        return false;
      }
    };

    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline) {
      const queued = await queueOffline();
      if (queued) {
        toast.info("No connection. The sheet is queued and uploads by itself when the network returns.");
        discardStaged();
        setPhoto(null);
        setPreUpload(null);
        setConfirming(false);
        setPollingUnit("");
        onClose();
      } else {
        toast.warning("Could not queue the sheet. Keep the app open and try again.");
        setConfirming(false);
      }
      setBusy(false);
      return;
    }

    try {
      const staged = preUpload?.status === "done" ? preUpload.tempPath : null;
      await uploadSheet(electionId, {
        pin,
        state,
        lga,
        pollingUnit: pollingUnit.trim() || undefined,
        ...(staged ? { tempPath: staged } : { photoDataUrl: photo }),
        ...coords,
      });
      // The staged file was MOVED into the sealed prefix by the server.
      committedRef.current = true;
      stagedRef.current = null;
      toast.success("Sheet uploaded. It is now part of the permanent record.");
      setPhoto(null);
      setPreUpload(null);
      setConfirming(false);
      setPollingUnit("");
      onUploaded();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      // A network-shaped failure gets queued rather than lost; a server
      // rejection (bad PIN, closed election) is shown, not retried.
      if (/network|fetch|failed \(5|load/i.test(msg)) {
        const queued = await queueOffline();
        if (queued) {
          toast.info("Connection is rough. The sheet is queued and uploads by itself.");
          discardStaged();
          setPhoto(null);
          setPreUpload(null);
          setConfirming(false);
          setPollingUnit("");
          onClose();
          setBusy(false);
          return;
        }
      }
      toast.warning(msg);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : onClose} title="Upload result sheet">
      <div className="space-y-4">
        {/* where */}
        <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setLga("");
              }}
              className="w-full glass-input rounded-xl pl-3 pr-10 text-sm text-dark-100 appearance-none"
            >
              <option value="">State...</option>
              {NIGERIA_STATES_LIST.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select
              value={lga}
              onChange={(e) => setLga(e.target.value)}
              disabled={!state}
              className="w-full glass-input rounded-xl pl-3 pr-10 text-sm text-dark-100 appearance-none disabled:opacity-40"
            >
              <option value="">LGA...</option>
              {(NIGERIA_LGAS[state] || []).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400 pointer-events-none" />
          </div>
        </div>
        <input
          value={pollingUnit}
          onChange={(e) => setPollingUnit(e.target.value)}
          maxLength={120}
          placeholder="Polling unit (optional, e.g. PU 014 Ward 3)"
          className="w-full glass-input rounded-xl px-4 text-sm text-dark-100 placeholder:text-dark-500"
        />

        {/* the photo */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickPhoto(f);
            e.target.value = "";
          }}
        />

        {!photo ? (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-2xl border border-dashed border-[var(--glass-border)] text-primary-400 active:scale-[0.97] transition-transform"
          >
            <Camera className="w-7 h-7" />
            <span className="text-sm font-medium">Photograph the result sheet</span>
            <span className="text-[11px] text-dark-500">Fill the frame, keep the figures readable</span>
          </button>
        ) : (
          <div className="space-y-2">
            <button
              onClick={() => setZoomed(true)}
              className="block w-full rounded-2xl overflow-hidden border border-[var(--glass-border)] active:scale-[0.99] transition-transform"
              aria-label="Expand the photo"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="Result sheet preview" className="w-full max-h-80 object-contain bg-black" />
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 py-2.5 rounded-xl bg-[var(--soft-surface)] text-dark-200 text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retake
              </button>
              <button
                onClick={() => {
                  discardStaged();
                  setPhoto(null);
                  setPreUpload(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[var(--soft-surface)] beacon-bad-text text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
              >
                <Trash2 className="w-3.5 h-3.5" /> Discard
              </button>
            </div>
            <p className="text-[11px] text-dark-500 text-center flex items-center justify-center gap-1.5">
              {preUpload?.status === "uploading" ? (
                <>
                  <CloudUpload className="w-3.5 h-3.5 beacon-accent-text" />
                  Preparing in the background...
                </>
              ) : preUpload?.status === "done" ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 beacon-ok-text" />
                  Ready. Retaking and discarding still possible until you upload.
                </>
              ) : (
                "Retaking and discarding are only possible now, before upload."
              )}
            </p>
          </div>
        )}

        {/* what the record will carry, visible BEFORE committing */}
        <div className="flex items-center gap-2 px-1">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              gps.status === "ok"
                ? "bg-green-500"
                : gps.status === "pending"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-red-500"
            }`}
          />
          <p className="text-[11px] text-dark-500">
            {gps.status === "ok"
              ? `Your position will be recorded with this upload (within ${Math.round(gps.accuracyM)} m)`
              : gps.status === "pending"
                ? "Getting your position..."
                : "Position unavailable. The record will carry no location, which reviewers can see."}
          </p>
        </div>

        {/* the point of no return, stated as such */}
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={!photo || !state || !lga}
            className="w-full py-3.5 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.97] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Upload className="w-4 h-4" /> Upload
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
              <TriangleAlert className="beacon-wait-text w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-xs text-dark-300 leading-relaxed">
                Once uploaded, this photo becomes part of the permanent
                election record for{" "}
                <span className="font-semibold text-dark-100">{lga}, {state}</span>.
                It cannot be edited, replaced or deleted by anyone, including
                you. Your location at upload is recorded with it.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="flex-1 py-3 rounded-2xl bg-[var(--soft-surface)] text-dark-200 text-sm font-medium active:scale-[0.97] transition-transform"
              >
                Go back
              </button>
              <button
                onClick={doUpload}
                disabled={busy}
                className="flex-1 py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {busy ? <PejaSpinner className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                {busy ? "Uploading..." : "Upload permanently"}
              </button>
            </div>
          </div>
        )}
      </div>

      {zoomed && photo && (
        <ImageLightbox isOpen onClose={() => setZoomed(false)} imageUrl={photo} />
      )}
    </Modal>
  );
}
