"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

const SESSION_KEY = "peja-analytics-session-id-v1";
const SESSION_ROW_KEY = "peja-analytics-session-row-id-v1";

// 30s heartbeat keeps last_seen_at updated for "time spent"
const HEARTBEAT_MS = 30_000;

function getOrCreateSessionId() {
  if (typeof window === "undefined") return null;
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function setSessionRowId(id: string) {
  try {
    sessionStorage.setItem(SESSION_ROW_KEY, id);
  } catch {}
}

function getSessionRowId() {
  try {
    return sessionStorage.getItem(SESSION_ROW_KEY);
  } catch {
    return null;
  }
}

export default function AnalyticsTracker() {
  const pathname = usePathname();
  const { user } = useAuth();

  const startedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionRowIdRef = useRef<string | null>(null);
  const lastPathRef = useRef<string | null>(null);

  // Start session + heartbeat when user is available
  useEffect(() => {
    if (!user?.id) return;
    if (startedRef.current) return;

    startedRef.current = true;

    const start = async () => {
      const sessionId = getOrCreateSessionId();
      if (!sessionId) return;

      sessionIdRef.current = sessionId;

      // If we already have a row id saved, reuse it
      const existingRowId = getSessionRowId();
      if (existingRowId) {
        sessionRowIdRef.current = existingRowId;
        return;
      }

      // Create a new session row
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;

      const { data, error } = await supabase
        .from("user_sessions")
        .insert({
          user_id: user.id,
          session_id: sessionId,
          started_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          user_agent: ua,
          platform: "web",
        })
        .select("id")
        .single();

      if (!error && data?.id) {
        sessionRowIdRef.current = data.id;
        setSessionRowId(data.id);
      } else {
        // If RLS prevents session insert, we silently skip analytics for now
        // (should not happen since you added policies)
        console.warn("analytics session insert error:", error?.message);
      }
    };

    start();

    const interval = setInterval(async () => {
      const rowId = sessionRowIdRef.current;
      if (!rowId || !user?.id) return;

      await supabase
        .from("user_sessions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", rowId)
        .eq("user_id", user.id);
    }, HEARTBEAT_MS);

    const onVisibility = async () => {
      // When tab becomes hidden, mark last_seen immediately
      if (document.hidden) {
        const rowId = sessionRowIdRef.current;
        if (!rowId || !user?.id) return;

        await supabase
          .from("user_sessions")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", rowId)
          .eq("user_id", user.id);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      startedRef.current = false;
    };
  }, [user?.id]);

  // Track page views + important opens (post/watch)
  useEffect(() => {
    if (!user?.id) return;
    if (!pathname) return;

    // prevent duplicate firing on same path
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;

    const sessionId = sessionIdRef.current || getOrCreateSessionId();

    const track = async () => {
      // Always log page_view
      await supabase.from("app_events").insert({
        user_id: user.id,
        session_id: sessionId,
        event_name: "page_view",
        screen: pathname,
        props: {},
      });

      // Bonus: log post_open automatically
      if (pathname.startsWith("/post/")) {
        const postId = pathname.split("/post/")[1] || null;
        await supabase.from("app_events").insert({
          user_id: user.id,
          session_id: sessionId,
          event_name: "post_open",
          screen: "post_detail",
          target_id: postId,
          props: {},
        });
      }

      // Bonus: log watch_open
      if (pathname === "/watch") {
        await supabase.from("app_events").insert({
          user_id: user.id,
          session_id: sessionId,
          event_name: "watch_open",
          screen: "watch",
          props: {},
        });
      }
    };

    track().catch((e) => {
      // analytics should never break app
      console.warn("analytics track error:", e?.message || e);
    });
  }, [pathname, user?.id]);

  return null;
}