"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import { adsEnabled } from "@/lib/ads";
import { AdModal } from "./AdModal";
import { buildingIcon } from "./buildingIcons";
import { metresLabel } from "@/lib/adsClient";

/**
 * Sponsored pins on the map.
 *
 * Three rules are enforced here and they are the whole reason this does
 * not feel like an advertising app:
 *
 *   SUPPRESSED. `suppress` is passed true during an active SOS or when an
 *   incident has just been reported nearby. The component then fetches
 *   nothing and renders nothing. Safety information never shares the
 *   screen with an advert.
 *
 *   CAPPED. The server returns at most two, already deduped so no two sit
 *   within 100m. However many businesses have paid, the map shows two.
 *
 *   QUIET. The pin is a building-type icon in muted colours, smaller than
 *   an incident pin. It should read as a landmark. Only on tap does the
 *   business appear.
 *
 * Which two show is decided from a per-session seed, so the selection
 * holds still while somebody pans around and differs next time. Two
 * people standing together see different pins, and across all sessions
 * every advertiser gets their share.
 */
type Pin = {
  id: string;
  businessName: string;
  tagline: string | null;
  category: string;
  logoUrl: string | null;
  socials: Record<string, string>;
  lat: number;
  lng: number;
  buildingType: string | null;
};

// One seed per tab. sessionStorage so a reload reshuffles but panning
// does not, which is what keeps pins from twitching as the map moves.
function sessionSeed(): string {
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

export function SponsoredPins({
  bounds,
  suppress,
  origin,
  onShowOnMap,
}: {
  bounds: { north: number; south: number; east: number; west: number } | null;
  suppress: boolean;
  origin?: { lat: number; lng: number } | null;
  onShowOnMap?: (lat: number, lng: number) => void;
}) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [open, setOpen] = useState<Pin | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const report = useCallback((ids: string[], kind: string) => {
    if (ids.length === 0) return;
    fetch("/api/ads/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placementIds: ids, kind }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!adsEnabled() || suppress || !bounds) { setPins([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const q = new URLSearchParams({
          want: "pins",
          seed: sessionSeed(),
          north: String(bounds.north), south: String(bounds.south),
          east: String(bounds.east), west: String(bounds.west),
        });
        const res = await fetch(`/api/ads/serve?${q}`);
        const json = await res.json();
        if (cancelled) return;
        const next: Pin[] = json.pins || [];
        setPins(next);
        // Count each placement once per session, not once per pan.
        const fresh = next.map((p) => p.id).filter((id) => !seen.current.has(id));
        fresh.forEach((id) => seen.current.add(id));
        report(fresh, "impression");
      } catch { /* an ad failure must never break the map */ }
    }, 400); // debounce: panning should not hammer this
    return () => { cancelled = true; clearTimeout(t); };
  }, [bounds, suppress, report]);

  // Feature off: render nothing and fetch nothing.
  if (!adsEnabled()) return null;

  if (suppress || pins.length === 0) return null;

  return (
    <>
      {pins.map((p) => {
        const Icon = buildingIcon(p.buildingType);
        return (
          <Marker key={p.id} latitude={p.lat} longitude={p.lng} anchor="center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(p);
                report([p.id], "tap");
              }}
              aria-label={p.businessName}
              className="w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition-transform"
              style={{
                background: "var(--glass-float-bg)",
                border: "1px solid var(--glass-border)",
                boxShadow: "var(--glass-shadow-sm)",
              }}
            >
              <Icon className="w-3.5 h-3.5 text-dark-300" />
            </button>
          </Marker>
        );
      })}

      {open && (
        <AdModal
          open
          onClose={() => setOpen(null)}
          businessName={open.businessName}
          tagline={open.tagline}
          category={open.category}
          logoUrl={open.logoUrl}
          socials={open.socials}
          distanceLabel={origin ? metresLabel(origin, { lat: open.lat, lng: open.lng }) : null}
          onSocial={() => report([open.id], "social")}
          onDirections={() => {
            report([open.id], "directions");
            onShowOnMap?.(open.lat, open.lng);
          }}
        />
      )}
    </>
  );
}
