"use client";

import { useEffect, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";

// Life360's trick: location DATA arrives in jumps (every 30-60s); the
// ANIMATION between points is what makes the map feel alive. Ease each
// marker from where it was to where it now is over ~1.5s.
const TWEEN_MS = 1500;
// Teleports (first fix, cross-city jump) snap instantly - a pin gliding
// across half of Lagos looks wrong and lies about the path taken.
const SNAP_DEGREES = 0.05; // ~5km

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useTweenedPosition(lat: number, lng: number): { lat: number; lng: number } {
  const [pos, setPos] = useState({ lat, lng });
  const raf = useRef(0);
  const current = useRef({ lat, lng });

  useEffect(() => {
    const from = { ...current.current };
    const dLat = lat - from.lat;
    const dLng = lng - from.lng;
    if (dLat === 0 && dLng === 0) return;

    if (Math.abs(dLat) > SNAP_DEGREES || Math.abs(dLng) > SNAP_DEGREES) {
      current.current = { lat, lng };
      setPos({ lat, lng });
      return;
    }

    const start = performance.now();
    cancelAnimationFrame(raf.current);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const k = easeOutCubic(t);
      const next = { lat: from.lat + dLat * k, lng: from.lng + dLng * k };
      current.current = next;
      setPos(next);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [lat, lng]);

  return pos;
}

/** Drop-in Marker whose position glides instead of jumping. */
export function TweenedMarker({
  latitude,
  longitude,
  anchor,
  children,
}: {
  latitude: number;
  longitude: number;
  anchor?: "center" | "bottom";
  children: React.ReactNode;
}) {
  const pos = useTweenedPosition(latitude, longitude);
  return (
    <Marker latitude={pos.lat} longitude={pos.lng} anchor={anchor}>
      {children}
    </Marker>
  );
}
