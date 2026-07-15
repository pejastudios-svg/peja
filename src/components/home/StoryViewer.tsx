"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle, BatteryCharging, Bike, Bus, Car, ChevronRight, Compass,
  Footprints, Home, KeyRound, Lock, MapPin, PhoneCall, ShieldAlert,
  ShoppingBag, Smartphone, UserCheck, Users, X,
} from "lucide-react";

const TIP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldAlert, MapPin, Bike, Smartphone, Compass, PhoneCall, Users,
  Car, Bus, Footprints, UserCheck, Lock, KeyRound, Home, BatteryCharging, ShoppingBag,
};

const TONE_BG: Record<string, string> = {
  violet: "from-primary-700 to-primary-900",
  amber: "from-amber-600 to-amber-800",
  green: "from-green-700 to-green-900",
  blue: "from-blue-700 to-blue-900",
};

export type Story =
  | {
      kind: "incident";
      id: string;
      category: string;
      categoryName: string;
      color: string;
      address: string | null;
      createdAt: string;
      mediaUrl: string | null;
      mediaType: string | null;
      confirmations: number;
    }
  | {
      kind: "tip";
      id: string;
      title: string;
      body: string;
      icon: string;
      tone: string;
    };

const STORY_MS = 6000;

/**
 * Full-screen story player (IG/Snap grammar): segmented progress bars,
 * tap right = next / left = prev, swipe down = dismiss, auto-advance.
 * Plays the given list start-to-finish then closes.
 */
export function StoryViewer({
  stories,
  startIndex = 0,
  onClose,
  onIndex,
}: {
  stories: Story[];
  startIndex?: number;
  onClose: () => void;
  onIndex?: (index: number) => void;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(startIndex);
  // Hold the latest callbacks without making them effect deps.
  const onCloseRef = useRef(onClose);
  const onIndexRef = useRef(onIndex);
  onCloseRef.current = onClose;
  onIndexRef.current = onIndex;
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const raf = useRef(0);
  const startRef = useRef(0);
  const dragStart = useRef<number | null>(null);

  const story = stories[index];

  // Advance can move PAST the end (index === length); a dedicated effect
  // then closes. Calling onClose inside a setState updater is illegal
  // (setState-in-render) and was the source of the console error.
  const next = useCallback(() => {
    setProgress(0);
    setIndex((i) => i + 1);
  }, []);

  const prev = useCallback(() => {
    setProgress(0);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Fire ONCE per index change; refs keep this off the parent's closures.
  useEffect(() => {
    if (index >= stories.length) onCloseRef.current();
    else onIndexRef.current?.(index);
  }, [index, stories.length]);

  // Auto-advance timer (rAF so pause is instant, no drift). Depends only
  // on index + paused - NOT on `story` (a fresh object each parent render).
  useEffect(() => {
    if (paused || index >= stories.length) return;
    startRef.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / STORY_MS);
      setProgress(p);
      if (p >= 1) next();
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, stories.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  if (!story) return null;

  return (
    <div
      className="fixed inset-0 z-[160000] bg-black flex flex-col select-none"
      onPointerDown={(e) => {
        dragStart.current = e.clientY;
        setPaused(true);
      }}
      onPointerUp={(e) => {
        const dy = dragStart.current != null ? e.clientY - dragStart.current : 0;
        dragStart.current = null;
        setPaused(false);
        if (dy > 90) onClose();
      }}
      onPointerCancel={() => { dragStart.current = null; setPaused(false); }}
    >
      {/* progress bars */}
      <div className="flex gap-1 px-3 pt-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        {stories.map((_, i) => (
          <div key={i} className="flex-1 h-0.5 rounded-full bg-white/25 overflow-hidden">
            <div
              className="h-full bg-white"
              style={{ width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%" }}
            />
          </div>
        ))}
      </div>

      <button
        onClick={onClose}
        className="absolute right-3 top-0 mt-3 p-2 z-20"
        style={{ marginTop: "calc(env(safe-area-inset-top, 0px) + 18px)" }}
        aria-label="Close"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {/* tap zones */}
      <button className="absolute left-0 top-0 bottom-0 w-1/3 z-10" onClick={prev} aria-label="Previous" />
      <button className="absolute right-0 top-0 bottom-0 w-1/3 z-10" onClick={next} aria-label="Next" />

      {/* content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        {story.kind === "incident" ? (
          <div className="w-full max-w-md">
            {story.mediaUrl && story.mediaType?.startsWith("video") ? (
              <video src={story.mediaUrl} className="w-full max-h-[45vh] rounded-2xl object-cover mb-5" autoPlay muted loop playsInline />
            ) : story.mediaUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={story.mediaUrl} alt="" className="w-full max-h-[45vh] rounded-2xl object-cover mb-5" />
            ) : (
              <div className="mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-5" style={{ background: `${story.color}22` }}>
                <AlertTriangle className="w-9 h-9" style={{ color: story.color }} />
              </div>
            )}
            <span
              className="inline-block px-3 py-1 rounded-full text-xs font-bold text-white mb-3"
              style={{ background: story.color }}
            >
              {story.categoryName}
            </span>
            <p className="text-white/90 text-base font-medium mb-1">
              {story.address || "Nearby"}
            </p>
            <p className="text-white/50 text-sm mb-1">
              {formatDistanceToNow(new Date(story.createdAt), { addSuffix: true })}
            </p>
            {story.confirmations > 0 && (
              <p className="text-white/60 text-sm">
                {story.confirmations} {story.confirmations === 1 ? "person" : "people"} confirmed this
              </p>
            )}
            <button
              onClick={() => { onClose(); router.push(`/post/${story.id}`); }}
              className="mt-6 inline-flex items-center gap-1 px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm active:scale-95 transition-transform z-20 relative"
            >
              View full report <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className={`w-full max-w-sm mx-auto rounded-3xl bg-gradient-to-b ${TONE_BG[story.tone] || TONE_BG.violet} p-7 flex flex-col items-center`}>
            <div className="mx-auto w-16 h-16 rounded-full bg-white/15 flex items-center justify-center mb-5">
              {(() => {
                const Icon = TIP_ICONS[story.icon] ?? ShieldAlert;
                return <Icon className="w-8 h-8 text-white" />;
              })()}
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-white/70 mb-2">Safety tip</p>
            <h2 className="text-2xl font-bold text-white mb-3 leading-tight">{story.title}</h2>
            <p className="text-white/85 text-[15px] leading-relaxed">{story.body}</p>
          </div>
        )}
      </div>
    </div>
  );
}
