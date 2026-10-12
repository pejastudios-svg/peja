"use client";

import { useCallback, useEffect, useState } from "react";
import { adsEnabled } from "@/lib/ads";
import { AdModal } from "./AdModal";
import { adSeed, metresLabel } from "@/lib/adsClient";

type Result = {
  id: string;
  businessName: string;
  tagline: string | null;
  category: string;
  logoUrl: string | null;
  socials: Record<string, string>;
  lat: number | null;
  lng: number | null;
  isFallback?: boolean;
};

/**
 * Sponsored search results.
 *
 * Drawn as ordinary result rows rather than banners, because that is what
 * makes them tolerable: somebody searching "pharmacy" wants a pharmacy,
 * and a nearby one at the top is useful whether or not it paid. The
 * Sponsored label is what keeps that honest.
 *
 * This is the highest-value surface in the app for exactly that reason.
 * Intent beats impressions.
 */
export function SponsoredResults({
  query,
  origin,
  suppress,
  onShowOnMap,
}: {
  query: string;
  origin: { lat: number; lng: number } | null;
  suppress?: boolean;
  onShowOnMap?: (lat: number, lng: number) => void;
}) {
  const [rows, setRows] = useState<Result[]>([]);
  const [open, setOpen] = useState<Result | null>(null);

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
    const q = query.trim();
    if (!adsEnabled() || suppress || !origin || q.length < 2) { setRows([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({
          want: "search", seed: adSeed(), category: q,
          lat: String(origin.lat), lng: String(origin.lng),
        });
        const res = await fetch(`/api/ads/serve?${sp}`);
        const json = await res.json();
        if (cancelled) return;
        const next: Result[] = json.sponsored || [];
        setRows(next);
        report(next.map((r) => r.id), "impression");
      } catch { /* search still works without ads */ }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, origin, suppress, report]);

  // Feature off: render nothing and fetch nothing.
  if (!adsEnabled()) return null;

  if (suppress || rows.length === 0) return null;

  // A fallback row did not match what was typed, so it does not get to
  // sit there looking like the answer. One line of context above it.
  const isFallback = rows.length === 1 && rows[0].isFallback;

  return (
    <div className="space-y-2 mb-3">
      {isFallback && (
        <p className="text-xs text-dark-500 px-1">
          No exact match. A business near you:
        </p>
      )}
      {rows.map((r) => (
        <button
          key={r.id}
          onClick={() => { setOpen(r); report([r.id], "tap"); }}
          className="w-full flex items-center gap-3 p-3 rounded-xl bg-[var(--glass-input-bg)] border border-[var(--glass-border)] text-left active:scale-[0.99] transition-ui"
        >
          {r.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.logoUrl} alt="" className="w-11 h-11 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-primary-500/15 shrink-0" />
          )}
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-dark-100 truncate">{r.businessName}</span>
            <span className="block text-xs text-dark-400 truncate">
              {r.category}
              {origin && r.lat != null && r.lng != null
                ? ` · ${metresLabel(origin, { lat: r.lat, lng: r.lng })} away`
                : ""}
            </span>
            {r.tagline && (
              <span className="block text-xs text-dark-500 truncate mt-0.5">{r.tagline}</span>
            )}
          </span>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-dark-500">
            Sponsored
          </span>
        </button>
      ))}

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
