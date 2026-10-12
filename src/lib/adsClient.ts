/** Small client-side helpers for ad surfaces. */

export function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "400m" under a kilometre, "1.2km" above. */
export function metresLabel(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): string {
  const m = metresBetween(a, b);
  return m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
}

/** Stable per-tab shuffle key. See SponsoredPins for why it is per session. */
export function adSeed(): string {
  try {
    let s = sessionStorage.getItem("peja-ad-seed");
    if (!s) {
      s = Math.random().toString(36).slice(2);
      sessionStorage.setItem("peja-ad-seed", s);
    }
    return s;
  } catch {
    return "0";
  }
}
