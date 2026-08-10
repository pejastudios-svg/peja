"use client";

import { useEffect, useState } from "react";
import { Briefcase, GraduationCap, Home, MapPin, BookOpen, Plus, ChevronRight } from "lucide-react";
import { PlaceEditorModal } from "@/components/places/PlaceEditorModal";
import { fetchPlaces, type Place, type PlaceKind } from "@/lib/places";

// "My Places" settings section: the saved locations that power check-in
// destinations and arrive/leave alerts. Beacon-attached places are managed
// from that Beacon's own screen, not here.

const KIND_ICONS: Record<PlaceKind, React.ReactNode> = {
  home: <Home className="w-4 h-4" />,
  school: <GraduationCap className="w-4 h-4" />,
  work: <Briefcase className="w-4 h-4" />,
  lesson: <BookOpen className="w-4 h-4" />,
  custom: <MapPin className="w-4 h-4" />,
};

export function PlacesSection() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Place | null>(null);
  const [creating, setCreating] = useState(false);
  const [createStart, setCreateStart] = useState<{ lat?: number; lng?: number }>({});

  useEffect(() => {
    let stop = false;
    fetchPlaces()
      .then((list) => {
        if (stop) return;
        setPlaces(list.filter((p) => !p.device_id));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      stop = true;
    };
  }, []);

  const openCreate = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCreateStart({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setCreating(true);
        },
        () => setCreating(true),
        { timeout: 3000, maximumAge: 60000 },
      );
    } else {
      setCreating(true);
    }
  };

  return (
    <section className="py-6 border-b border-[var(--hairline)]">
      <h2 className="text-sm font-semibold text-dark-400 uppercase mb-1">My Places</h2>
      <p className="text-xs text-dark-500 mb-4">
        Set a place as your destination when you start a check-in, and your
        people are told when you arrive or leave while sharing.
      </p>

      <div className="space-y-2">
        {places.map((p) => (
          <button
            key={p.id}
            onClick={() => setEditing(p)}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-[var(--glass-input-bg)] border border-[var(--glass-border)] text-left active:scale-[0.97] transition-transform"
          >
            <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0 text-primary-400">
              {KIND_ICONS[p.kind]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-dark-100 truncate">{p.label}</p>
              <p className="text-xs text-dark-500">
                Arrival zone {p.radius_m} m
                {p.visible_to_circle ? "" : ", hidden from your circle"}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
          </button>
        ))}

        {loaded && places.length === 0 && (
          <p className="text-sm text-dark-500 text-center py-3">
            No places yet. Save your home, school or work to use them as
            destinations.
          </p>
        )}

        <button
          onClick={openCreate}
          className="w-full flex items-center justify-center gap-1.5 p-3 rounded-xl border border-dashed border-[var(--glass-border)] text-sm font-medium text-primary-400 active:scale-[0.97] transition-transform"
        >
          <Plus className="w-4 h-4" /> Add a place
        </button>
      </div>

      {(creating || editing) && (
        <PlaceEditorModal
          isOpen
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          place={editing}
          initialLat={createStart.lat}
          initialLng={createStart.lng}
          onSaved={(p) =>
            setPlaces((prev) => {
              const i = prev.findIndex((x) => x.id === p.id);
              if (i === -1) return [...prev, p];
              const next = [...prev];
              next[i] = p;
              return next;
            })
          }
          onDeleted={(id) => setPlaces((prev) => prev.filter((x) => x.id !== id))}
        />
      )}
    </section>
  );
}
