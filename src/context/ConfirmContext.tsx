"use client";

import React, { createContext, useContext, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { createDebouncedAction } from "@/lib/debounceAction";
import { notifyPostConfirmed } from "@/lib/notifications";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

type ConfirmCtx = {
  confirmed: Set<string>;
  counts: Record<string, number>;
  hydrateCounts: (pairs: { postId: string; confirmations: number }[]) => void;
  loadConfirmedFor: (postIds: string[]) => Promise<void>;
  isConfirmed: (postId: string) => boolean;
  getCount: (postId: string, fallback: number) => number;
  toggle: (postId: string, fallbackCount: number) => Promise<{ confirmed: boolean; newCount: number } | null>;
};

const Ctx = createContext<ConfirmCtx | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const inFlight = useRef<Set<string>>(new Set());
  const debouncedRpc = useRef(createDebouncedAction(500));
  const toast = useToast();
  const toastApi = useToast();

  const loadedRef = useRef<Set<string>>(new Set());

  const hydrateCounts = (pairs: { postId: string; confirmations: number }[]) => {
    setCounts((prev) => {
      const next = { ...prev };
      for (const p of pairs) {
        if (typeof next[p.postId] !== "number") next[p.postId] = p.confirmations || 0;
      }
      return next;
    });

    // Auto-load confirmed status for any post IDs we haven't checked yet
    if (user?.id) {
      const newIds = pairs
        .map((p) => p.postId)
        .filter((id) => !loadedRef.current.has(id));
      if (newIds.length > 0) {
        newIds.forEach((id) => loadedRef.current.add(id));
        // Call loadConfirmedFor asynchronously — it's defined below in the same closure
        // and will be available when this callback actually executes
        supabase
          .from("post_confirmations")
          .select("post_id")
          .eq("user_id", user.id)
          .in("post_id", newIds)
          .then(({ data, error }) => {
            if (error) {
              return;
            }
            setConfirmed((prev) => {
              const next = new Set(prev);
              (data || []).forEach((r: any) => next.add(r.post_id));
              return next;
            });
          });
      }
    }
  };

  const loadConfirmedFor = async (postIds: string[]) => {
    if (!user?.id) return;
    const ids = Array.from(new Set(postIds)).filter(Boolean);
    if (!ids.length) return;

    const { data, error } = await supabase
      .from("post_confirmations")
      .select("post_id")
      .eq("user_id", user.id)
      .in("post_id", ids);

    if (error) {
      return;
    }

    setConfirmed((prev) => {
      const next = new Set(prev);
      (data || []).forEach((r: any) => next.add(r.post_id));
      return next;
    });
  };

  const isConfirmed = (postId: string) => confirmed.has(postId);
  const getCount = (postId: string, fallback: number) =>
    typeof counts[postId] === "number" ? counts[postId] : fallback;

  const toggle = async (postId: string, fallbackCount: number) => {
    if (!user?.id) return null;
        if (user.status !== "active") {
      toastApi.warning("Your account is suspended. You cannot confirm incidents.");
      return null;
    }
    if (user.status !== "active") {
  toast.warning("Your account is suspended. You cannot confirm incidents.");
  return null;
}
    if (inFlight.current.has(postId)) return null;
    inFlight.current.add(postId);

    const was = confirmed.has(postId);
    const current = getCount(postId, fallbackCount);

    // optimistic
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (was) next.delete(postId);
      else next.add(postId);
      return next;
    });

    setCounts((prev) => ({
      ...prev,
      [postId]: was ? Math.max(0, current - 1) : current + 1,
    }));

    try {
      // Debounced RPC — only fires after user stops tapping for 500ms
      return new Promise<{ confirmed: boolean; newCount: number } | null>((resolve) => {
        debouncedRpc.current(postId, async () => {
          try {
            const { data, error } = await supabase.rpc("toggle_post_confirmation", {
              p_post_id: postId,
              p_user_id: user.id,
            });

            if (error) throw error;

            const row = data?.[0];
            const serverConfirmed = !!row?.confirmed;
            const serverCount = Number(row?.new_count ?? 0);

            setConfirmed((prev) => {
              const next = new Set(prev);
              if (serverConfirmed) next.add(postId);
              else next.delete(postId);
              return next;
            });
            setCounts((prev) => ({ ...prev, [postId]: serverCount }));

            // Only notify after debounced RPC confirms
            if (serverConfirmed && user?.id) {
              // Fetch post owner to notify (we dont have it in context)
              supabase.from("posts").select("user_id").eq("id", postId).single().then(({ data: postData }) => {
                if (postData?.user_id && postData.user_id !== user.id) {
                  notifyPostConfirmed(postId, postData.user_id, user.full_name || user.email || "Someone");
                }
              });
            }

            resolve({ confirmed: serverConfirmed, newCount: serverCount });
          } catch (e) {
            // rollback
            setConfirmed((prev) => {
              const next = new Set(prev);
              if (was) next.add(postId);
              else next.delete(postId);
              return next;
            });
            setCounts((prev) => ({ ...prev, [postId]: current }));
            resolve(null);
          }
        });
      });
    } catch (e) {
      return null;
    } finally {
      inFlight.current.delete(postId);
    }
  };

  const value = useMemo(
    () => ({ confirmed, counts, hydrateCounts, loadConfirmedFor, isConfirmed, getCount, toggle }),
    [confirmed, counts]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}