"use client";

import React, { createContext, useContext, useRef, useMemo, useCallback } from "react";

/**
 * PageCacheContext
 *
 * Generic page-level data cache with stale-while-revalidate semantics.
 * Unlike FeedContext (which stores Post[] arrays), this stores arbitrary
 * serializable data keyed by page identifier.
 *
 * Usage:
 *   const cache = usePageCache();
 *   cache.set("profile:userPosts", posts);
 *   const cached = cache.get("profile:userPosts");
 *   cache.setMeta("profile", { activeTab: "posts" });
 *   const meta = cache.getMeta("profile");
 */

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
}

interface MetaEntry<T = any> {
  data: T;
  timestamp: number;
}

interface ScrollEntry {
  y: number;
  timestamp: number;
}

interface PageCacheContextType {
  // Data cache
  set: <T>(key: string, data: T) => void;
  get: <T>(key: string) => T | null;
  getWithAge: <T>(key: string) => { data: T; ageMs: number } | null;
  remove: (key: string) => void;
  invalidate: (keyPrefix: string) => void;
  invalidateAll: () => void;

  // Meta cache (UI state like active tabs, filter selections)
  setMeta: <T>(key: string, data: T) => void;
  getMeta: <T>(key: string) => T | null;

  // Scroll cache (separate from FeedContext scroll)
  setScroll: (key: string, y: number) => void;
  getScroll: (key: string) => number;
  clearScroll: (key: string) => void;
}

const Ctx = createContext<PageCacheContextType | null>(null);

export function PageCacheProvider({ children }: { children: React.ReactNode }) {
  const dataRef = useRef<Map<string, CacheEntry>>(new Map());
  const metaRef = useRef<Map<string, MetaEntry>>(new Map());
  const scrollRef = useRef<Map<string, ScrollEntry>>(new Map());

  const set = useCallback(<T,>(key: string, data: T) => {
    dataRef.current.set(key, { data, timestamp: Date.now() });
  }, []);

  const get = useCallback(<T,>(key: string): T | null => {
    const entry = dataRef.current.get(key);
    if (!entry) return null;
    return entry.data as T;
  }, []);

  const getWithAge = useCallback(<T,>(key: string): { data: T; ageMs: number } | null => {
    const entry = dataRef.current.get(key);
    if (!entry) return null;
    return { data: entry.data as T, ageMs: Date.now() - entry.timestamp };
  }, []);

  const remove = useCallback((key: string) => {
    dataRef.current.delete(key);
  }, []);

  const invalidate = useCallback((keyPrefix: string) => {
    const keysToDelete: string[] = [];
    dataRef.current.forEach((_, k) => {
      if (k.startsWith(keyPrefix)) keysToDelete.push(k);
    });
    keysToDelete.forEach((k) => dataRef.current.delete(k));
  }, []);

  const invalidateAll = useCallback(() => {
    dataRef.current.clear();
  }, []);

  const setMeta = useCallback(<T,>(key: string, data: T) => {
    metaRef.current.set(key, { data, timestamp: Date.now() });
  }, []);

  const getMeta = useCallback(<T,>(key: string): T | null => {
    const entry = metaRef.current.get(key);
    if (!entry) return null;
    return entry.data as T;
  }, []);

  const setScroll = useCallback((key: string, y: number) => {
    scrollRef.current.set(key, { y, timestamp: Date.now() });
  }, []);

  const getScroll = useCallback((key: string): number => {
    const entry = scrollRef.current.get(key);
    if (!entry) return 0;
    return entry.y;
  }, []);

  const clearScroll = useCallback((key: string) => {
    scrollRef.current.delete(key);
  }, []);

  const value = useMemo<PageCacheContextType>(
    () => ({
      set,
      get,
      getWithAge,
      remove,
      invalidate,
      invalidateAll,
      setMeta,
      getMeta,
      setScroll,
      getScroll,
      clearScroll,
    }),
    [set, get, getWithAge, remove, invalidate, invalidateAll, setMeta, getMeta, setScroll, getScroll, clearScroll]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageCache() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePageCache must be used within PageCacheProvider");
  return ctx;
}