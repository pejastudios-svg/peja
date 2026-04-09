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

const FEED_STORAGE_KEY = "peja-feed-cache";
const MAX_PERSIST_POSTS = 10;

function loadPersistedFeed(): Map<FeedKey, FeedCacheValue> {
  const map = new Map<FeedKey, FeedCacheValue>();
  if (typeof window === "undefined") return map;
  try {
    const raw = localStorage.getItem(FEED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Only restore if less than 10 minutes old
      if (parsed.updatedAt && Date.now() - parsed.updatedAt < 10 * 60 * 1000) {
        map.set(parsed.key, {
          posts: parsed.posts || [],
          updatedAt: parsed.updatedAt,
          scrollY: 0,
        });
      }
    }
  } catch {}
  return map;
}

function persistFeed(key: FeedKey, posts: Post[]) {
  if (typeof window === "undefined") return;
  try {
    // Only persist the first few posts to keep localStorage small
    const sliced = posts.slice(0, MAX_PERSIST_POSTS).map(p => ({
      ...p,
      // Strip heavy fields to save space
      media: p.media?.map(m => ({ url: m.url, media_type: m.media_type, thumbnail_url: m.thumbnail_url })),
    }));
    localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify({
      key,
      posts: sliced,
      updatedAt: Date.now(),
    }));
  } catch {}
}

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<Map<FeedKey, FeedCacheValue>>(loadPersistedFeed());
  const api = useMemo<FeedContextType>(() => {
    return {
      get: (key) => storeRef.current.get(key) || null,
      setPosts: (key, posts) => {
        const prev = storeRef.current.get(key);
        storeRef.current.set(key, {
          posts,
          updatedAt: Date.now(),
          scrollY: prev?.scrollY || 0,
        });
        // Persist the default feed for instant load on next open
        if (key.includes("nearby") || key === "feed:nearby") {
          persistFeed(key, posts);
        }
      },
      setScroll: (key, y) => {
        const prev = storeRef.current.get(key);
        if (!prev) {
          storeRef.current.set(key, { posts: [], updatedAt: Date.now(), scrollY: y });
        } else {
          storeRef.current.set(key, { ...prev, scrollY: y });
        }
      },
      invalidateAll: () => {
        storeRef.current.clear();
      },
      removePost: (postId: string) => {
        storeRef.current.forEach((value, key) => {
          const filtered = value.posts.filter(p => p.id !== postId);
          if (filtered.length !== value.posts.length) {
            storeRef.current.set(key, {
              ...value,
              posts: filtered,
            });
          }
        });
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