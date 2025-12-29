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
};

const FeedContext = createContext<FeedContextType | null>(null);

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<Map<FeedKey, FeedCacheValue>>(new Map());

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
      },
      setScroll: (key, y) => {
        const prev = storeRef.current.get(key);
        if (!prev) {
          storeRef.current.set(key, { posts: [], updatedAt: Date.now(), scrollY: y });
        } else {
          storeRef.current.set(key, { ...prev, scrollY: y });
        }
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