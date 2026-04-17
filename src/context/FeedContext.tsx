"use client";

import React, { createContext, useContext, useMemo, useRef } from "react";
import { Post } from "@/lib/types";

type FeedKey = string;

type FeedCacheValue = {
  posts: Post[];
  updatedAt: number;
  scrollY: number;
};

type FeedContextType = {
  get: (key: FeedKey) => FeedCacheValue | null;
  setPosts: (key: FeedKey, posts: Post[]) => void;
  setScroll: (key: FeedKey, y: number) => void;
  invalidateAll: () => void;
  removePost: (postId: string) => void;
};

const FeedContext = createContext<FeedContextType | null>(null);

const STORAGE_KEY = "peja-feed-v1";
const MAX_AGE = 10 * 60 * 1000; // 10 minutes

function loadPersistedFeed(): Map<FeedKey, FeedCacheValue> {
  const map = new Map<FeedKey, FeedCacheValue>();
  if (typeof window === "undefined") return map;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return map;
    const parsed: Record<string, FeedCacheValue> = JSON.parse(raw);
    const now = Date.now();
    Object.entries(parsed).forEach(([key, val]) => {
      if (val.updatedAt && now - val.updatedAt < MAX_AGE && val.posts?.length) {
        map.set(key, val);
      }
    });
  } catch {}
  return map;
}

function persistFeed(store: Map<FeedKey, FeedCacheValue>) {
  try {
    const obj: Record<string, FeedCacheValue> = {};
    store.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {}
}

export function FeedProvider({ children }: { children: React.ReactNode }) {
  // Lazy-init ref: reads from localStorage synchronously on first render only
  const storeRef = useRef<Map<FeedKey, FeedCacheValue> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = loadPersistedFeed();
  }

  const api = useMemo<FeedContextType>(() => {
    return {
      get: (key) => storeRef.current!.get(key) || null,
      setPosts: (key, posts) => {
        const prev = storeRef.current!.get(key);
        storeRef.current!.set(key, {
          posts,
          updatedAt: Date.now(),
          scrollY: prev?.scrollY || 0,
        });
        persistFeed(storeRef.current!);
      },
      setScroll: (key, y) => {
        const prev = storeRef.current!.get(key);
        if (!prev) {
          storeRef.current!.set(key, { posts: [], updatedAt: Date.now(), scrollY: y });
        } else {
          storeRef.current!.set(key, { ...prev, scrollY: y });
        }
      },
      invalidateAll: () => {
        storeRef.current!.clear();
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
      },
      removePost: (postId: string) => {
        storeRef.current!.forEach((value, key) => {
          const filtered = value.posts.filter(p => p.id !== postId);
          if (filtered.length !== value.posts.length) {
            storeRef.current!.set(key, { ...value, posts: filtered });
          }
        });
        persistFeed(storeRef.current!);
      },
    };
  }, []);

  return <FeedContext.Provider value={api}>{children}</FeedContext.Provider>;
}

export function useFeedCache() {
  const ctx = useContext(FeedContext);
  if (!ctx) throw new Error("useFeedCache must be used within FeedProvider");
  return ctx;
}
