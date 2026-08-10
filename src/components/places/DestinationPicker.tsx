"use client";

import { useEffect, useState } from "react";
import { Briefcase, GraduationCap, Home, MapPin, BookOpen, Plus, Navigation } from "lucide-react";
import { PlaceEditorModal } from "@/components/places/PlaceEditorModal";
import { fetchPlaces, type Place, type PlaceKind } from "@/lib/places";

// Optional destination row for the check-in sheet. Chips, not a second
// stacked sheet: picking where you are going should cost one tap, and
// skipping it should cost none.

const KIND_ICONS: Record<PlaceKind, React.ReactNode> = {
  home: <Home className="w-3.5 h-3.5" />,
  school: <GraduationCap className="w-3.5 h-3.5" />,
  work: <Briefcase className="w-3.5 h-3.5" />,
  lesson: <BookOpen className="w-3.5 h-3.5" />,
  custom: <MapPin className="w-3.5 h-3.5" />,
};

export function DestinationPicker({
  selected,
  onChange,
}: {
  selected: Place | null;
  onChange: (place: Place | null) => void;
}) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStart, setEditorStart] = useState<{ lat?: number; lng?: number }>({});

  useEffect(() => {
    let stop = false;
    fetchPlaces()
      .then((list) => {
        // Personal places only; a Beacon's places belong to its wearer.
        if (!stop) setPlaces(list.filter((p) => !p.device_id));
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  const openEditor = () => {
    // Seed the editor near the traveler so the pin starts where they are.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setEditorStart({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setEditorOpen(true);
        },
        () => setEditorOpen(true),
        { timeout: 3000, maximumAge: 60000 },
      );
    } else {
      setEditorOpen(true);
    }
  };

  return (
    <div className="mb-4">
      <label className="text-sm font-medium text-dark-200 mb-2 block">
        <Navigation className="w-4 h-4 inline mr-1.5" />
        Going somewhere?
        <span className="text-dark-500 font-normal"> (optional)</span>
      </label>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => onChange(null)}
          className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-colors active:scale-[0.97] ${
            !selected
              ? "bg-primary-600 text-white"
              : "bg-[var(--glass-input-bg)] border border-[var(--glass-border)] text-dark-300"
          }`}
        >
          No destination
        </button>
        {places.map((p) => (
          <button
            key={p.id}
            onClick={() => onChange(selected?.id === p.id ? null : p)}
            className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors active:scale-[0.97] ${
              selected?.id === p.id
                ? "bg-primary-600 text-white"
                : "bg-[var(--glass-input-bg)] border border-[var(--glass-border)] text-dark-300"
            }`}
          >
            {KIND_ICONS[p.kind]}
            {p.label}
          </button>
        ))}
        <button
          onClick={openEditor}
          className="shrink-0 px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-1 bg-[var(--glass-input-bg)] border border-dashed border-[var(--glass-border)] text-dark-400 active:scale-[0.97] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New place
        </button>
      </div>
      {selected && (
        <p className="text-[11px] text-dark-500 mt-1.5">
          Your people will be told when you arrive at {selected.label}.
        </p>
      )}

      {editorOpen && (
        <PlaceEditorModal
          isOpen={editorOpen}
          onClose={() => setEditorOpen(false)}
          initialLat={editorStart.lat}
          initialLng={editorStart.lng}
          onSaved={(p) => {
            setPlaces((prev) => [...prev, p]);
            onChange(p);
          }}
        />
      )}
    </div>
  );
}
