"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Portal } from "@/components/ui/Portal";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";
import { tipsForToday } from "@/lib/safetyTips";
import { StoryViewer, type Story } from "./StoryViewer";
import {
  BatteryCharging, Bike, Bus, Car, ChevronDown, ChevronUp, Compass, Footprints, Home, KeyRound,
  Lock, MapPin, PhoneCall, ShieldAlert, ShoppingBag, Smartphone, UserCheck, Users,
} from "lucide-react";
import type { NearbyIncident } from "./CircleSheet";

const TIP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldAlert, MapPin, Bike, Smartphone, Compass, PhoneCall, Users,
  Car, Bus, Footprints, UserCheck, Lock, KeyRound, Home, BatteryCharging, ShoppingBag,
};
const TONE_RING: Record<string, string> = {
  violet: "ring-primary-500",
  amber: "ring-amber-500",
  green: "ring-green-500",
  blue: "ring-blue-500",
};

// Filled-glyph rendering. Lucide icons are stroke art, so "fill" means:
// white fill on closed shapes + inner detail engraved in the badge tone.
// Icons whose defining parts are OPEN strokes (bike frame, user torsos,
// battery segments, lock shackle, phone waves) must keep white strokes
// or those parts vanish into the badge.
const OPEN_STROKE_ICONS = new Set([
  "Users", "UserCheck", "Bike", "Lock", "BatteryCharging", "PhoneCall",
]);
const TIP_ENGRAVE = "#5b21b6"; // primary-800: matches the tip badge gradient

function filledIconProps(name: string, engrave: string) {
  const open = OPEN_STROKE_ICONS.has(name);
  return {
    fill: "currentColor" as const,
    stroke: open ? ("currentColor" as const) : engrave,
    strokeWidth: open ? 2 : 1.5,
  };
}

const SEVERITY_COLOR: Record<string, string> = {
  danger: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
  awareness: "#8b5cf6",
};

interface Group {
  id: string;
  label: string;
  icon: React.ReactNode;
  ring: string;
  stories: Story[];
  seedIds: string[]; // ids that mark this group "viewed"
}

const VIEWED_KEY = "peja-stories-viewed";

function readViewed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VIEWED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function markViewed(ids: string[]) {
  try {
    const set = readViewed();
    ids.forEach((id) => set.add(id));
    localStorage.setItem(VIEWED_KEY, JSON.stringify([...set].slice(-200)));
  } catch {}
}

/**
 * The local-pulse rail: horizontal story circles above the map. "Near
 * you" bundles nearby incidents; safety-tip circles fill quiet days.
 * Tapping opens the full-screen StoryViewer.
 */
export function StoryRail({ incidents }: { incidents: NearbyIncident[] }) {
  const [media, setMedia] = useState<Record<string, { url: string; type: string; confirmations: number }>>({});
  const [viewerStart, setViewerStart] = useState<number | null>(null);
  // Minimized mode: the circles stack into a compact cluster. Base state
  // is open; the choice sticks per device.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("peja-stories-collapsed") === "1"; } catch { return false; }
  });
  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem("peja-stories-collapsed", v ? "1" : "0"); } catch {}
  };
  const [viewed, setViewed] = useState<Set<string>>(() =>
    typeof window !== "undefined" ? readViewed() : new Set()
  );

  const incidentIds = incidents.map((i) => i.id).join(",");

  // Enrich the nearest incidents with first media + confirmation count.
  useEffect(() => {
    const ids = incidents.slice(0, 8).map((i) => i.id);
    if (ids.length === 0) return;
    let stop = false;
    (async () => {
      const [mediaRes, postsRes] = await Promise.all([
        supabase.from("post_media").select("post_id, url, media_type").in("post_id", ids),
        supabase.from("posts").select("id, confirmations").in("id", ids),
      ]);
      if (stop) return;
      const confById = new Map((postsRes.data || []).map((p) => [p.id, p.confirmations || 0]));
      const firstMedia = new Map<string, { url: string; type: string }>();
      for (const m of mediaRes.data || []) {
        if (!firstMedia.has(m.post_id)) firstMedia.set(m.post_id, { url: m.url, type: m.media_type || "image" });
      }
      const out: Record<string, { url: string; type: string; confirmations: number }> = {};
      for (const id of ids) {
        const fm = firstMedia.get(id);
        out[id] = { url: fm?.url || "", type: fm?.type || "", confirmations: confById.get(id) || 0 };
      }
      setMedia(out);
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentIds]);

  const groups = useMemo<Group[]>(() => {
    const gs: Group[] = [];

    if (incidents.length > 0) {
      const stories: Story[] = incidents.slice(0, 8).map((i) => {
        const cat = CATEGORIES.find((c) => c.id === i.category);
        const m = media[i.id];
        return {
          kind: "incident",
          id: i.id,
          category: i.category,
          categoryName: cat?.name || "Incident",
          color: SEVERITY_COLOR[cat?.color || "info"],
          address: i.address,
          createdAt: i.createdAt,
          mediaUrl: m?.url || null,
          mediaType: m?.type || null,
          confirmations: m?.confirmations || 0,
        };
      });
      gs.push({
        id: "near-you",
        label: "Near you",
        icon: <MapPin className="w-5 h-5 text-white" {...filledIconProps("MapPin", "#b91c1c")} />,
        ring: "ring-red-500",
        stories,
        seedIds: incidents.slice(0, 8).map((i) => `inc-${i.id}`),
      });
    }

    for (const tip of tipsForToday(5)) {
      const Icon = TIP_ICONS[tip.icon] ?? ShieldAlert;
      gs.push({
        id: `tip-${tip.id}`,
        label: "Tip",
        icon: <Icon className="w-5 h-5 text-white" {...filledIconProps(tip.icon, TIP_ENGRAVE)} />,
        ring: TONE_RING[tip.tone] || TONE_RING.violet,
        stories: [{ kind: "tip", id: tip.id, title: tip.title, body: tip.body, icon: tip.icon, tone: tip.tone }],
        seedIds: [`tip-${tip.id}`],
      });
    }
    return gs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentIds, media]);

  // One flat list across every circle; each group remembers where it
  // begins so tapping a circle starts there and playback flows into the
  // next circle instead of closing at a group boundary. Memoized so the
  // StoryViewer props stay referentially stable (no render loop).
  const { allStories, groupStart } = useMemo(() => {
    const flat: Story[] = groups.flatMap((g) => g.stories);
    const starts: number[] = [];
    let acc = 0;
    for (const g of groups) { starts.push(acc); acc += g.stories.length; }
    return { allStories: flat, groupStart: starts };
  }, [groups]);

  const handleIndex = useCallback(
    (idx: number) => {
      const seen: string[] = [];
      groups.forEach((g, gi) => {
        if (idx >= groupStart[gi]) seen.push(...g.seedIds);
      });
      if (seen.length) {
        markViewed(seen);
        setViewed((prev) => {
          // Only update if something is actually new - avoids a needless
          // re-render (and any chance of a feedback loop).
          const missing = seen.filter((id) => !prev.has(id));
          return missing.length ? new Set([...prev, ...missing]) : prev;
        });
      }
    },
    [groups, groupStart]
  );

  // All hooks are above this line (rules-of-hooks).
  if (groups.length === 0) return null;

  const openGroup = (g: Group, i: number) => {
    setViewerStart(groupStart[i]);
    // Mark THIS group's circle seen; later groups get marked as the
    // viewer reaches them via onAdvance below.
    markViewed(g.seedIds);
    setViewed((prev) => new Set([...prev, ...g.seedIds]));
  };

  if (collapsed) {
    const stack = groups.slice(0, 3);
    const anyUnseen = groups.some((g) => !g.seedIds.every((id) => viewed.has(id)));
    return (
      <div className="flex justify-end px-4 py-1">
        <button
          onClick={() => setCollapsedPersist(false)}
          aria-label="Show stories"
          className="beacon-pop flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-1.5 active:scale-95 transition-transform"
          style={{ background: "rgba(0,0,0,0.45)" }}
        >
          <div className="flex items-center">
            {stack.map((g, i) => (
              <div
                key={g.id}
                className={`w-8 h-8 rounded-full flex items-center justify-center ring-2 border border-black/40 ${
                  g.seedIds.every((id) => viewed.has(id)) ? "ring-dark-600" : g.ring
                } ${g.id === "near-you" ? "bg-gradient-to-b from-red-600 to-red-800" : "bg-gradient-to-b from-primary-700 to-primary-900"} ${
                  i > 0 ? "-ml-3.5" : ""
                }`}
                style={{ zIndex: stack.length - i }}
              >
                <span className="scale-[0.8] flex">{g.icon}</span>
              </div>
            ))}
          </div>
          {groups.length > stack.length && (
            <span className="text-[11px] font-bold text-white">+{groups.length - stack.length}</span>
          )}
          {anyUnseen && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
          <ChevronDown className="w-4 h-4 text-white/80" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto hide-scrollbar px-4 py-1">
        <div className="flex gap-2.5 w-max mx-auto">
        {groups.map((g, gi) => {
          const allSeen = g.seedIds.every((id) => viewed.has(id));
          return (
            <button
              key={g.id}
              onClick={() => openGroup(g, groups.indexOf(g))}
              className="beacon-pop flex flex-col items-center gap-1 shrink-0 active:scale-95 transition-transform"
              style={{ animationDelay: `${Math.min(gi * 0.04, 0.3)}s` }}
            >
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center bg-dark-800 ring-2 ${
                  allSeen ? "ring-dark-600" : g.ring
                } ${g.id === "near-you" ? "bg-gradient-to-b from-red-600 to-red-800" : "bg-gradient-to-b from-primary-700 to-primary-900"}`}
              >
                {g.icon}
                {g.id === "near-you" && (
                  <span className="absolute mt-7 ml-7 min-w-4 h-4 px-1 rounded-full bg-white text-red-600 text-[11px] font-bold flex items-center justify-center border-2 border-black/80">
                    {g.stories.length}
                  </span>
                )}
              </div>
              <span
                className="text-[10px] font-semibold text-white max-w-[56px] truncate"
                style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
              >
                {g.label}
              </span>
            </button>
          );
        })}
        <button
          onClick={() => setCollapsedPersist(true)}
          aria-label="Minimize stories"
          className="shrink-0 self-start mt-2.5 w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform"
          style={{ background: "rgba(0,0,0,0.45)" }}
        >
          <ChevronUp className="w-4 h-4 text-white/80" />
        </button>
        </div>
      </div>

      {viewerStart != null && (
        <Portal>
          <StoryViewer
            stories={allStories}
            startIndex={viewerStart}
            onClose={() => setViewerStart(null)}
            onIndex={handleIndex}
          />
        </Portal>
      )}
    </>
  );
}
