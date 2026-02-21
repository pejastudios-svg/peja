"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

export function usePresence() {
  const { user } = useAuth();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!user?.id || initializedRef.current) return;
    initializedRef.current = true;

    const setOnline = async () => {
      await supabase.from("user_presence").upsert(
        { user_id: user.id, is_online: true, last_seen: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    };

    const setOffline = async () => {
      await supabase.from("user_presence").upsert(
        { user_id: user.id, is_online: false, last_seen: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    };

    setOnline();

    // Heartbeat every 30s
    intervalRef.current = setInterval(setOnline, 30000);

    // Go offline on visibility change or unload
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        setOffline();
      } else {
        setOnline();
      }
    };

    const handleBeforeUnload = () => {
      // Use sendBeacon for reliability
      const payload = JSON.stringify({
        user_id: user.id,
        is_online: false,
        last_seen: new Date().toISOString(),
      });
      navigator.sendBeacon?.(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/user_presence?on_conflict=user_id`,
        new Blob([payload], { type: "application/json" })
      );
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      setOffline();
      initializedRef.current = false;
    };
  }, [user?.id]);
}