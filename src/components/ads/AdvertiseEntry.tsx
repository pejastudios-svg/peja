"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { adsEnabled, tierSpec, type AdTier } from "@/lib/ads";

/**
 * The business slot at the bottom of the home sheet.
 *
 * Two states, because the same space serves two people. Somebody with no
 * adverts gets the pitch; somebody who already advertises gets their
 * adverts, so they are not hunting through Settings to check on them.
 *
 * No dismiss. It sits below places, where you have to scroll past
 * everything that matters to reach it, so it is not in anybody's way.
 * A close button only created a way to lose it permanently by tapping
 * without reading.
 */
type Mine = {
  id: string;
  tier: AdTier;
  status: string;
  lga: string | null;
  name: string;
};

const STATUS_DOT: Record<string, string> = {
  live: "bg-green-400",
  pending: "bg-amber-400",
  paused: "bg-dark-500",
  rejected: "bg-red-400",
};

export function AdvertiseEntry() {
  const router = useRouter();
  const { user } = useAuth();
  const [mine, setMine] = useState<Mine[] | null>(null);

  const load = useCallback(async () => {
    try {
      const { res, data } = await authFetchJson("/api/ads/mine");
      if (!res.ok || !data) { setMine([]); return; }
      const names: Record<string, string> = {};
      for (const a of data.advertisers || []) names[a.id] = a.business_name;
      setMine(
        (data.placements || []).map((p: { id: string; tier: AdTier; status: string; lga: string | null; advertiser_id: string }) => ({
          id: p.id,
          tier: p.tier,
          status: p.status,
          lga: p.lga,
          name: names[p.advertiser_id] || "Your business",
        })),
      );
    } catch {
      setMine([]);
    }
  }, []);

  useEffect(() => {
    if (adsEnabled() && user) load();
  }, [user, load]);

  // Feature off: no card, and no request for placements either.
  if (!adsEnabled()) return null;
  if (!user) return null;

  // Nothing yet: the pitch. Whole card is the button, not just the link
  // at the bottom of it.
  if (!mine || mine.length === 0) {
    return (
      <button
        onClick={() => router.push("/advertise")}
        className="w-full text-left rounded-2xl p-4 bg-[var(--glass-input-bg)] border border-[var(--glass-border)] active:scale-[0.99] transition-transform"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-500/15 flex items-center justify-center shrink-0">
            <Megaphone className="w-[18px] h-[18px] beacon-accent-text" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-dark-100">
              Run a business around here?
            </p>
            <p className="text-xs text-dark-400 mt-0.5 leading-relaxed">
              Put it on the map your neighbours already check. No billboards,
              no agency.
            </p>
            <p className="text-xs font-semibold text-primary-400 mt-2">
              See how it works
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-dark-500 shrink-0 mt-1" />
        </div>
      </button>
    );
  }

  // Two at most, then a plus. More than that belongs on the dashboard,
  // and this is a shortcut rather than a list.
  const shown = mine.slice(0, 2);

  return (
    <div className="rounded-2xl p-4 bg-[var(--glass-input-bg)] border border-[var(--glass-border)]">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-dark-100">My adverts</p>
        {mine.length > 2 && (
          <button
            onClick={() => router.push("/advertise/dashboard")}
            className="text-xs text-primary-400 hover:text-primary-300"
          >
            See all {mine.length}
          </button>
        )}
      </div>

      <div className="flex items-stretch gap-2">
        {shown.map((m) => (
          <button
            key={m.id}
            onClick={() => router.push("/advertise/dashboard")}
            className="flex-1 min-w-0 text-left px-3 py-2.5 rounded-xl bg-[var(--soft-surface)] border border-[var(--hairline)] active:scale-[0.98] transition-transform"
          >
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[m.status] || "bg-dark-500"}`} />
              <span className="text-xs font-medium text-dark-100 truncate">{m.name}</span>
            </span>
            <span className="block text-[11px] text-dark-400 truncate mt-0.5">
              {tierSpec(m.tier).name}
              {m.lga ? ` · ${m.lga}` : ""}
            </span>
          </button>
        ))}

        <button
          onClick={() => router.push("/advertise")}
          aria-label="Add another advert"
          className="shrink-0 w-11 rounded-xl bg-[var(--soft-surface)] border border-[var(--hairline)] flex items-center justify-center active:scale-[0.98] transition-transform"
        >
          <Plus className="w-4 h-4 beacon-accent-text" />
        </button>
      </div>
    </div>
  );
}
