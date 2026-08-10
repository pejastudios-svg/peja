"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import MapGL, { MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { Briefcase, GraduationCap, Home, MapPin, BookOpen, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { useToast } from "@/context/ToastContext";
import {
  createPlace,
  deletePlace,
  updatePlace,
  type Place,
  type PlaceKind,
  PLACE_KINDS,
} from "@/lib/places";

// Create/edit one saved place. The map pans UNDER a fixed centre pin (the
// exact pattern ride-hailing apps use for "move the map to set the point"),
// with the arrival zone drawn live as a screen-space circle so dragging the
// radius slider gives immediate feedback at the current zoom.

const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`;

const KIND_ICONS: Record<PlaceKind, React.ReactNode> = {
  home: <Home className="w-4 h-4" />,
  school: <GraduationCap className="w-4 h-4" />,
  work: <Briefcase className="w-4 h-4" />,
  lesson: <BookOpen className="w-4 h-4" />,
  custom: <MapPin className="w-4 h-4" />,
};

export function PlaceEditorModal({
  isOpen,
  onClose,
  onSaved,
  onDeleted,
  place,
  initialLat,
  initialLng,
  initialLabel,
  deviceId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (place: Place) => void;
  onDeleted?: (id: string) => void;
  /** Editing an existing place; omit to create. */
  place?: Place | null;
  /** Starting point when creating (long-press coords, current location...). */
  initialLat?: number;
  initialLng?: number;
  initialLabel?: string | null;
  /** Create the place for a hosted Beacon instead of the account itself. */
  deviceId?: string | null;
}) {
  const toast = useToast();
  const mapRef = useRef<MapRef | null>(null);

  const [label, setLabel] = useState(place?.label ?? initialLabel ?? "");
  const [kind, setKind] = useState<PlaceKind>(place?.kind ?? "home");
  const [radiusM, setRadiusM] = useState(place?.radius_m ?? 150);
  const [visible, setVisible] = useState(place?.visible_to_circle ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startLat = place?.lat ?? initialLat ?? 6.5244; // Lagos fallback
  const startLng = place?.lng ?? initialLng ?? 3.3792;

  // Camera state, only what the radius overlay needs to size itself.
  const [view, setView] = useState({ lat: startLat, zoom: 15 });
  const center = useRef({ lat: startLat, lng: startLng });

  // Screen radius of the arrival zone at the current zoom (Web Mercator
  // metres per pixel at the centre latitude).
  const radiusPx = useMemo(() => {
    const mpp = (156543.03392 * Math.cos((view.lat * Math.PI) / 180)) / 2 ** view.zoom;
    return Math.max(12, radiusM / mpp);
  }, [radiusM, view]);

  const save = useCallback(async () => {
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      toast.warning("Give the place a name");
      return;
    }
    setBusy(true);
    try {
      const { lat, lng } = center.current;
      const saved = place
        ? await updatePlace(place.id, {
            label: cleanLabel,
            kind,
            lat,
            lng,
            radiusM,
            visibleToCircle: visible,
          })
        : await createPlace({
            label: cleanLabel,
            kind,
            lat,
            lng,
            radiusM,
            visibleToCircle: visible,
            deviceId: deviceId || null,
          });
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Could not save the place");
    } finally {
      setBusy(false);
    }
  }, [label, kind, radiusM, visible, place, deviceId, onSaved, onClose, toast]);

  const remove = useCallback(async () => {
    if (!place) return;
    setBusy(true);
    try {
      await deletePlace(place.id);
      onDeleted?.(place.id);
      onClose();
    } catch (e) {
      toast.warning(e instanceof Error ? e.message : "Could not delete the place");
    } finally {
      setBusy(false);
    }
  }, [place, onDeleted, onClose, toast]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={place ? "Edit place" : "New place"}>
      <div className="space-y-4">
        {/* map with fixed centre pin + live arrival zone */}
        <div className="relative h-56 rounded-2xl overflow-hidden border border-[var(--glass-border)]">
          <MapGL
            ref={mapRef}
            initialViewState={{ latitude: startLat, longitude: startLng, zoom: 15 }}
            mapStyle={MAP_STYLE}
            attributionControl={false}
            onMove={(e) => {
              center.current = {
                lat: e.viewState.latitude,
                lng: e.viewState.longitude,
              };
              setView({ lat: e.viewState.latitude, zoom: e.viewState.zoom });
            }}
          />
          {/* arrival zone, centred with the pin */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
            style={{
              width: radiusPx * 2,
              height: radiusPx * 2,
              background: "rgba(139, 92, 246, 0.15)",
              border: "1.5px solid rgba(139, 92, 246, 0.55)",
            }}
          />
          {/* the pin itself, tip on the centre point. Same assembly as the
              map's long-press pin so the two read as one thing. */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full flex flex-col items-center pointer-events-none">
            <div className="w-9 h-9 rounded-full bg-primary-600 border-[3px] border-white shadow-xl flex items-center justify-center">
              <MapPin className="w-4.5 h-4.5 text-white" fill="currentColor" stroke="#6d28d9" strokeWidth={1.5} />
            </div>
            <div className="w-1 h-2.5 bg-white rounded-b-full -mt-0.5 shadow" />
          </div>
          <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] px-2.5 py-1 rounded-full bg-black/55 text-white/90 pointer-events-none whitespace-nowrap">
            Move the map to set the point
          </p>
        </div>

        {/* name */}
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="Name this place"
          className="w-full glass-input rounded-xl px-4 text-sm text-dark-100 placeholder:text-dark-500"
        />

        {/* kind */}
        <div className="grid grid-cols-5 gap-1.5">
          {PLACE_KINDS.map((k) => (
            <button
              key={k.kind}
              onClick={() => setKind(k.kind)}
              className={`py-2 rounded-xl flex flex-col items-center gap-1 text-[11px] font-medium transition-colors active:scale-[0.97] ${
                kind === k.kind
                  ? "bg-primary-600 text-white"
                  : "bg-[var(--glass-input-bg)] border border-[var(--glass-border)] text-dark-300"
              }`}
            >
              {KIND_ICONS[k.kind]}
              {k.label}
            </button>
          ))}
        </div>

        {/* radius */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-dark-200">Arrival zone</label>
            <span className="text-xs text-dark-400 tabular-nums">{radiusM} m</span>
          </div>
          <input
            type="range"
            min={100}
            max={500}
            step={50}
            value={radiusM}
            onChange={(e) => setRadiusM(Number(e.target.value))}
            className="w-full accent-[#7c3aed]"
          />
          <p className="text-[11px] text-dark-500 mt-1">
            Arriving means staying inside this circle for about a minute, so GPS
            drift at the fence line never counts.
          </p>
        </div>

        {/* circle visibility */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--glass-input-bg)] border border-[var(--glass-border)]">
          <div className="min-w-0 pr-3">
            <p className="text-sm font-medium text-dark-100">Show to my circle</p>
            <p className="text-xs text-dark-500">
              People who can already see this location may also see the place on
              their map
            </p>
          </div>
          <Toggle on={visible} onChange={setVisible} />
        </div>

        {/* actions */}
        <button
          onClick={save}
          disabled={busy}
          className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <PejaSpinner className="w-4 h-4" /> : null}
          {place ? "Save changes" : "Save place"}
        </button>

        {place && (
          confirmDelete ? (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2.5 rounded-2xl bg-[var(--soft-surface)] text-dark-200 text-sm font-medium active:scale-[0.97] transition-transform"
              >
                Keep it
              </button>
              <button
                onClick={remove}
                disabled={busy}
                className="flex-1 py-2.5 rounded-2xl bg-red-600 text-white text-sm font-semibold active:scale-[0.97] transition-transform disabled:opacity-50"
              >
                Delete place
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full py-2.5 rounded-2xl text-sm font-medium beacon-bad-text flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
            >
              <Trash2 className="w-4 h-4" /> Delete this place
            </button>
          )
        )}
      </div>
    </Modal>
  );
}
