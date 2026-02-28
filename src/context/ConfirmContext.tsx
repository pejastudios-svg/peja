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
  const toastApi = useToast();
  const loadedRef = useRef<Set<string>>(new Set());
  const debouncedRpc = useRef(createDebouncedAction(600));
  const originalState = useRef<Record<string, boolean>>({});
  const notifiedPosts = useRef<Set<string>>(new Set());

  const hydrateCounts = (pairs: { postId: string; confirmations: number }[]) => {
    setCounts((prev) => {
      const next = { ...prev };
      for (const p of pairs) {
        if (typeof next[p.postId] !== "number") next[p.postId] = p.confirmations || 0;
      }
      return next;
    });

    if (user?.id) {
      const newIds = pairs
        .map((p) => p.postId)
        .filter((id) => !loadedRef.current.has(id));
      if (newIds.length > 0) {
        newIds.forEach((id) => loadedRef.current.add(id));
        supabase
          .from("post_confirmations")
          .select("post_id")
          .eq("user_id", user.id)
          .in("post_id", newIds)
          .then(({ data, error }) => {
            if (error) return;
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

    if (error) return;

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

    const currentlyConfirmed = confirmed.has(postId);
    const currentCount = getCount(postId, fallbackCount);

    // Save original state on FIRST tap only
    if (!(postId in originalState.current)) {
      originalState.current[postId] = currentlyConfirmed;
    }

    // Optimistic UI update
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (currentlyConfirmed) next.delete(postId);
      else next.add(postId);
      return next;
    });
    setCounts((prev) => ({
      ...prev,
      [postId]: currentlyConfirmed ? Math.max(0, currentCount - 1) : currentCount + 1,
    }));

    const newState = !currentlyConfirmed;

    // Debounce: wait 600ms after last tap, then decide
    return new Promise<{ confirmed: boolean; newCount: number } | null>((resolve) => {
      debouncedRpc.current(postId, async () => {
        const origState = originalState.current[postId];
        delete originalState.current[postId];

        // If final state === original state, user toggled back — skip RPC
        if (newState === origState) {
          resolve(null);
          return;
        }

        // State actually changed — send ONE RPC call
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

          // Only notify ONCE per post per session
          if (serverConfirmed && user?.id && !notifiedPosts.current.has(postId)) {
            notifiedPosts.current.add(postId);
            supabase.from("posts").select("user_id").eq("id", postId).single().then(({ data: postData }) => {
              if (postData?.user_id && postData.user_id !== user.id) {
                notifyPostConfirmed(postId, postData.user_id, user.full_name || user.email || "Someone");
              }
            });
          }

          resolve({ confirmed: serverConfirmed, newCount: serverCount });
        } catch (e) {
          // Rollback to original state
          setConfirmed((prev) => {
            const next = new Set(prev);
            if (origState) next.add(postId);
            else next.delete(postId);
            return next;
          });
          setCounts((prev) => ({ ...prev, [postId]: currentCount }));
          resolve(null);
        }
      });
    });
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
