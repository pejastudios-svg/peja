"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdBanner } from "./AdBanner";
import { adsEnabled } from "@/lib/ads";
import { AdModal } from "./AdModal";
import { adSeed, metresLabel } from "@/lib/adsClient";

type Slide = {
  id: string;
  businessName: string;
  tagline: string | null;
  category: string;
  logoUrl: string | null;
  socials: Record<string, string>;
  lat: number | null;
  lng: number | null;
  bannerText: string | null;
  bannerGradient: string | null;
};

/**
 * The Featured carousel.
 *
 * It rotates because the alternative does not work: a single static slot
 * shared by every Featured advertiser in a city would show each of them
 * roughly never. Rotating slides, capped per area, is what makes the tier
 * sellable more than a dozen times and still worth buying.
 *
 * Swipeable, and auto-advance pauses the moment somebody touches it, so
 * it never slides out from under a thumb.
 */
const AUTO_MS = 6000;

// Last slides served, so a return visit paints instantly instead of
// showing nothing until a round trip finishes. The delay was never one
// slow query, it was the order of events: wait for a position, then ask
// the server, then draw. By the time the banner appeared the reader was
// already typing, and it arrived as an interruption rather than content.
const CACHE_KEY = "peja-ad-carousel";

function readCache(): Slide[] {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? (v as Slide[]) : [];
  } catch {
    return [];
  }
}

export function SponsoredCarousel({
  origin,
  suppress,
  onShowOnMap,
}: {
  origin: { lat: number; lng: number } | null;
  suppress?: boolean;
  onShowOnMap?: (lat: number, lng: number) => void;
}) {
  const [slides, setSlides] = useState<Slide[]>(readCache);
  // Cached slides are drawn but not billed. They may be stale, or for an
  // area the reader has since left, and an advertiser should never pay
  // for an impression we are not certain we served.
  const [fresh, setFresh] = useState(false);
  const [i, setI] = useState(0);
  const [open, setOpen] = useState<Slide | null>(null);
  const paused = useRef(false);
  const counted = useRef<Set<string>>(new Set());

  const report = useCallback((ids: string[], kind: string) => {
    if (!ids.length) return;
    fetch("/api/ads/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placementIds: ids, kind }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!adsEnabled() || suppress) { setSlides([]); return; }
    // No position yet: keep whatever is cached on screen and wait. It is
    // the same ads either way, and blanking it here is what made the
    // banner flash in and out on the way to the search box.
    if (!origin) return;
    let cancelled = false;
    (async () => {
      try {
        const q = new URLSearchParams({
          want: "carousel", seed: adSeed(),
          lat: String(origin.lat), lng: String(origin.lng),
        });
        const res = await fetch(`/api/ads/serve?${q}`);
        const json = await res.json();
        if (cancelled) return;
        const atTop = window.scrollY < 40;
        const next: Slide[] = json.carousel || [];
        setSlides(next);
        setFresh(true);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch {}
        // Arriving above the fold should not push the reader down past
        // it. Only when they have not scrolled away themselves.
        if (atTop && next.length > 0) {
          requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
        }
      } catch { /* an ad failure must never break the page */ }
    })();
    return () => { cancelled = true; };
  }, [origin, suppress]);

  // Count a slide once it has actually been on screen.
  useEffect(() => {
    const s = slides[i];
    if (!fresh || !s || counted.current.has(s.id)) return;
    counted.current.add(s.id);
    report([s.id], "impression");
  }, [slides, i, fresh, report]);

  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => {
      if (!paused.current) setI((n) => (n + 1) % slides.length);
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [slides.length]);

  // Feature off: render nothing and fetch nothing.
  if (!adsEnabled()) return null;

  if (suppress || slides.length === 0) return null;
  const s = slides[i];

  return (
    <div className="mb-4">
      <div
        onPointerDown={() => { paused.current = true; }}
        onPointerUp={() => { paused.current = false; }}
        onPointerLeave={() => { paused.current = false; }}
      >
        <button
          onClick={() => { setOpen(s); report([s.id], "tap"); }}
          className="w-full text-left active:scale-[0.99] transition-transform"
        >
          <AdBanner
            businessName={s.businessName}
            text={s.bannerText}
            gradient={s.bannerGradient}
            logoUrl={s.logoUrl}
            compact
          />
        </button>
      </div>

      {slides.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {slides.map((_, n) => (
            <button
              key={n}
              onClick={() => setI(n)}
              aria-label={`Slide ${n + 1}`}
              className={`h-1.5 rounded-full transition-ui ${
                n === i ? "w-4 bg-primary-500" : "w-1.5 bg-dark-600"
              }`}
            />
          ))}
        </div>
      )}

      {open && (
        <AdModal
          open
          onClose={() => setOpen(null)}
          businessName={open.businessName}
          tagline={open.tagline}
          category={open.category}
          logoUrl={open.logoUrl}
          socials={open.socials}
          distanceLabel={
            origin && open.lat != null && open.lng != null
              ? metresLabel(origin, { lat: open.lat, lng: open.lng })
              : null
          }
          onSocial={() => report([open.id], "social")}
          onDirections={() => {
            report([open.id], "directions");
            if (open.lat != null && open.lng != null) onShowOnMap?.(open.lat, open.lng);
          }}
        />
      )}
    </div>
  );
}
