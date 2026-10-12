"use client";

import { useCallback, useRef, useState } from "react";
import MapGL, { type MapRef } from "react-map-gl/maplibre";
import { MapPin, Crosshair, Loader2 } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Place the pin by dragging the map.
 *
 * Search alone does not work here. Nigerian street data is sparse
 * enough that a real address, house number and all, usually returns
 * nothing: "No 2 Bomardek, Okota, Lagos" finds Ikota in Eti-Osa, four
 * LGAs away. Searching the AREA works, so search gets you close and
 * this puts you exact.
 *
 * The pin is fixed to the centre and the map moves under it, rather
 * than a draggable marker. On a phone that is the difference between
 * one thumb and two, and you can never lose the pin off-screen.
 */
const STYLE = `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`;

export function LocationPicker({
  lat,
  lng,
  onChange,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const [locating, setLocating] = useState(false);

  const settle = useCallback(() => {
    const c = mapRef.current?.getMap().getCenter();
    if (c) onChange(c.lat, c.lng);
  }, [onChange]);

  const jumpToMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        mapRef.current?.getMap().easeTo({
          center: [p.coords.longitude, p.coords.latitude],
          zoom: 17,
          duration: 600,
        });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div>
      <div className="relative rounded-xl overflow-hidden border border-[var(--glass-border)]" style={{ height: 220 }}>
        <MapGL
          ref={mapRef}
          mapStyle={STYLE}
          initialViewState={{ latitude: lat, longitude: lng, zoom: 16 }}
          onMoveEnd={settle}
          attributionControl={false}
          dragRotate={false}
          style={{ width: "100%", height: "100%" }}
        />

        {/* Fixed to the centre, above the map, never part of it. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-5">
          <MapPin className="w-8 h-8 text-primary-400 drop-shadow-lg" strokeWidth={2.5} />
        </div>

        <button
          type="button"
          onClick={jumpToMe}
          aria-label="Centre on me"
          className="absolute bottom-2 right-2 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
          style={{
            background: "var(--glass-float-bg)",
            border: "1px solid var(--glass-border)",
            boxShadow: "var(--glass-shadow-float)",
          }}
        >
          {locating
            ? <Loader2 className="w-4 h-4 animate-spin beacon-accent-text" />
            : <Crosshair className="w-4 h-4 beacon-accent-text" />}
        </button>
      </div>

      <p className="text-[11px] text-dark-500 mt-1.5">
        Drag the map so the pin sits on your door.
      </p>
    </div>
  );
}
