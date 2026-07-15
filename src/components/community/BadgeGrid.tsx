"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { ACHIEVEMENTS } from "@/lib/achievements";
import {
  HeartHandshake, MapPin, Megaphone, Moon, Shield, Sprout, Sunrise, UserCheck, Users,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Sunrise, UserCheck, Users, Shield, HeartHandshake, MapPin, Moon, Megaphone, Sprout,
};

/**
 * Profile badge grid: unlocked badges in color, locked ones greyed with
 * their hint - aspiration, not shame (Duolingo-style).
 */
export function BadgeGrid() {
  const { user } = useAuth();
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("user_achievements")
        .select("key")
        .eq("user_id", user.id);
      setUnlocked(new Set((data || []).map((r) => r.key)));
      setLoaded(true);
    })();
  }, [user]);

  if (!loaded) return null;
  const count = ACHIEVEMENTS.filter((a) => unlocked.has(a.key)).length;

  return (
    <div className="glass-card mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-dark-300">Badges</h3>
        <span className="text-xs text-dark-500">
          {count}/{ACHIEVEMENTS.length}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {ACHIEVEMENTS.map((a, i) => {
          const has = unlocked.has(a.key);
          const Icon = ICONS[a.icon] ?? Shield;
          return (
            <div
              key={a.key}
              className={`beacon-stagger flex flex-col items-center text-center rounded-2xl p-3 border ${
                has
                  ? "border-primary-500/30 bg-primary-500/10"
                  : "border-dark-700/60 bg-dark-800/30 opacity-55"
              }`}
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center mb-1.5 ${
                  has ? "bg-primary-500/20" : "bg-dark-700/50"
                }`}
              >
                <Icon className={has ? "beacon-accent-text w-5 h-5" : "w-5 h-5 text-dark-500"} />
              </div>
              <p className={`text-[11px] font-semibold leading-tight ${has ? "text-dark-100" : "text-dark-400"}`}>
                {a.name}
              </p>
              <p className="text-[10px] text-dark-500 leading-tight mt-0.5">
                {has ? a.description : a.hint}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
