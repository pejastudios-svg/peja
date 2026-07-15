"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { authFetchJson } from "@/lib/authFetch";
import { ConfirmConfetti } from "@/components/ui/ConfirmConfetti";
import { ACHIEVEMENT_BY_KEY } from "@/lib/achievements";
import {
  HeartHandshake, MapPin, Megaphone, Moon, Shield, Sprout, Sunrise, UserCheck, Users,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Sunrise, UserCheck, Users, Shield, HeartHandshake, MapPin, Moon, Megaphone, Sprout,
};

interface Unlock {
  notificationId: string;
  key: string;
}

/**
 * Global celebration layer: watches for unread achievement_unlocked
 * notifications and turns each into a confetti moment. One at a time,
 * quiet, over in seconds - Duolingo energy, Life360 restraint.
 */
export function AchievementCelebration() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<Unlock[]>([]);
  const [confetti, setConfetti] = useState(false);
  const [betweenCards, setBetweenCards] = useState(false);

  // Daily derived-badge sync on app open - nobody has to find the
  // community page to receive what they've already earned.
  useEffect(() => {
    if (!user) return;
    const KEY = "peja-achievements-synced-at";
    try {
      const last = Number(localStorage.getItem(KEY) || 0);
      if (Date.now() - last < 24 * 60 * 60_000) return;
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
    authFetchJson("/api/achievements/sync", { method: "POST" }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let stop = false;
    const check = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, data")
        .eq("user_id", user.id)
        .eq("is_read", false)
        .filter("data->>type", "eq", "achievement_unlocked")
        .order("created_at", { ascending: true })
        .limit(10);
      if (stop || !data) return;
      const unlocks = data
        .map((n) => ({ notificationId: n.id, key: (n.data?.key as string) || "" }))
        .filter((u) => ACHIEVEMENT_BY_KEY.has(u.key));
      if (unlocks.length > 0) {
        setQueue((prev) => (prev.length > 0 ? prev : unlocks));
      }
    };
    check();
    const t = setInterval(check, 30_000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => { stop = true; clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [user]);

  const current = queue[0] ?? null;
  const def = current ? ACHIEVEMENT_BY_KEY.get(current.key) : null;

  // Fire the confetti when a celebration mounts.
  useEffect(() => {
    if (current) {
      const t = setTimeout(() => setConfetti(true), 250);
      if (navigator.vibrate) navigator.vibrate([12, 50, 24]);
      return () => { clearTimeout(t); setConfetti(false); };
    }
  }, [current?.notificationId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current || !def || betweenCards) return null;
  const Icon = ICONS[def.icon] ?? Shield;

  const dismiss = async () => {
    supabase.from("notifications").update({ is_read: true }).eq("id", current.notificationId)
      .then(() => {});
    // Close fully, breathe, then the next celebration runs its ENTIRE
    // entrance (pop + confetti + haptic) from zero.
    setBetweenCards(true);
    setTimeout(() => {
      setQueue((prev) => prev.slice(1));
      setBetweenCards(false);
    }, 400);
  };

  const dismissAll = async () => {
    const ids = queue.map((q) => q.notificationId);
    supabase.from("notifications").update({ is_read: true }).in("id", ids).then(() => {});
    setQueue([]);
  };

  return (
    <div className="fixed inset-0 z-[150000] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={dismiss} />
      <ConfirmConfetti trigger={confetti} />
      <div
        className="relative w-full max-w-xs rounded-3xl p-6 text-center beacon-pop"
        style={{
          background: "var(--glass-strong-bg)",
          border: "1px solid var(--glass-border-strong)",
          boxShadow: "var(--glass-shadow-strong)",
        }}
      >
        <div className="mx-auto w-20 h-20 rounded-full bg-primary-500/15 border border-primary-500/30 flex items-center justify-center mb-4">
          <Icon className="beacon-accent-text w-9 h-9" />
        </div>
        <p className="text-xs font-bold uppercase tracking-widest beacon-accent-text mb-1">
          Badge unlocked
        </p>
        <h2 className="text-xl font-bold text-dark-50 mb-1.5">{def.name}</h2>
        <p className="text-sm text-dark-400 leading-relaxed mb-5">{def.description}</p>
        <button
          onClick={dismiss}
          className="w-full py-3 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.98] transition-transform"
        >
          Nice
        </button>
        {queue.length > 1 && (
          <button
            onClick={dismissAll}
            className="w-full mt-2 py-2 text-sm font-medium text-dark-400 active:scale-[0.98] transition-transform"
          >
            Dismiss all ({queue.length})
          </button>
        )}
      </div>
    </div>
  );
}
