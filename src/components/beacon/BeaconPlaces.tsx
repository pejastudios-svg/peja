"use client";

import { useEffect, useState } from "react";
import { Briefcase, GraduationCap, Home, MapPin, BookOpen, Plus, ChevronRight } from "lucide-react";
import { PlaceEditorModal } from "@/components/places/PlaceEditorModal";
import { fetchPlaces, type Place, type PlaceKind } from "@/lib/places";
import type { BeaconDevice } from "@/lib/beacon";

// This wearer's own places: Ada's school, Ada's basketball practice.
// Arrive/leave alerts go to everyone who can see this Beacon, and the
// places show on their maps labelled with the wearer's name.

const KIND_ICONS: Record<PlaceKind, React.ReactNode> = {
  home: <Home className="w-4 h-4" />,
  school: <GraduationCap className="w-4 h-4" />,
  work: <Briefcase className="w-4 h-4" />,
  lesson: <BookOpen className="w-4 h-4" />,
  custom: <MapPin className="w-4 h-4" />,
};

export function BeaconPlaces({ device }: { device: BeaconDevice }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [editing, setEditing] = useState<Place | null>(null);
  const [creating, setCreating] = useState(false);
  const wearer = device.wearer_name || device.name || "this Beacon";

  useEffect(() => {
    let stop = false;
    fetchPlaces()
      .then((list) => {
        if (!stop) setPlaces(list.filter((p) => p.device_id === device.id));
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [device.id]);

  return (
    <div className="rounded-2xl bg-dark-800/50 border border-dark-700 p-3.5">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
          <MapPin className="beacon-accent-text w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-dark-100">{wearer}&apos;s places</p>
          <p className="text-xs text-dark-500">
            Everyone who can see this Beacon is told on arrival and leaving
          </p>
        </div>
      </div>

      <div className="mt-2.5 space-y-2">
        {places.map((p) => (
          <button
            key={p.id}
            onClick={() => setEditing(p)}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-[var(--soft-surface)] text-left active:scale-[0.97] transition-transform"
          >
            <span className="text-dark-400">{KIND_ICONS[p.kind]}</span>
            <span className="flex-1 text-sm text-dark-100 truncate">{p.label}</span>
            <span className="text-[11px] text-dark-500 tabular-nums">{p.radius_m} m</span>
            <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
          </button>
        ))}

        <button
          onClick={() => setCreating(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-dark-600 text-xs font-medium text-primary-400 active:scale-[0.97] transition-transform"
        >
          <Plus className="w-3.5 h-3.5" /> Add a place for {wearer}
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
          deviceId={device.id}
          initialLat={device.last_lat ?? undefined}
          initialLng={device.last_lng ?? undefined}
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
    </div>
  );
}
