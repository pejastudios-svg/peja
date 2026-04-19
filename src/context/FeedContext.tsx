"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { Post } from "@/lib/types";
import { realtimeManager } from "@/lib/realtime";

type FeedKey = string;

type FeedCacheValue = {
  posts: Post[];
  updatedAt: number;
  scrollY: number;
};

type PendingCreate = { post: Post; createdAt: number };
type PendingState = {
  creates: Record<string, PendingCreate>;
  deletes: Record<string, number>;
};

type FeedContextType = {
  get: (key: FeedKey) => FeedCacheValue | null;
  setPosts: (key: FeedKey, posts: Post[]) => void;
  setScroll: (key: FeedKey, y: number) => void;
  invalidateAll: () => void;
  removePost: (postId: string) => void;
  // Client-authoritative overlay for the user's own in-flight actions.
  trackCreate: (post: Post) => void;
  trackDelete: (postId: string) => void;
  applyOverlay: (posts: Post[]) => Post[];
  applyDeletes: (posts: Post[]) => Post[];
  reconcile: (fetched: Post[]) => void;
};

const FeedContext = createContext<FeedContextType | null>(null);

const STORAGE_KEY = "peja-feed-v2";
const PENDING_KEY = "peja-feed-pending-v1";
const MAX_AGE = 10 * 60 * 1000; // 10 minutes for cached feeds
const PENDING_TTL = 2 * 60 * 1000; // 2 minutes — server should have caught up by then

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

function loadPending(): PendingState {
  const empty: PendingState = { creates: {}, deletes: {} };
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return empty;
    const parsed: PendingState = JSON.parse(raw);
    const now = Date.now();
    const creates: Record<string, PendingCreate> = {};
    Object.entries(parsed.creates || {}).forEach(([id, v]) => {
      if (v?.createdAt && now - v.createdAt < PENDING_TTL) creates[id] = v;
    });
    const deletes: Record<string, number> = {};
    Object.entries(parsed.deletes || {}).forEach(([id, ts]) => {
      if (typeof ts === "number" && now - ts < PENDING_TTL) deletes[id] = ts;
    });
    return { creates, deletes };
  } catch {}
  return empty;
}

function persistPending(state: PendingState) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(state));
  } catch {}
}

export function FeedProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<Map<FeedKey, FeedCacheValue> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = loadPersistedFeed();
  }

  const pendingRef = useRef<PendingState | null>(null);
  if (pendingRef.current === null) {
    pendingRef.current = loadPending();
  }

  // Global realtime sync: keep caches and pending overlay in step with the server.
  useEffect(() => {
    const removeFromCaches = (id?: string) => {
      if (!id) return;
      const store = storeRef.current!;
      let changed = false;
      store.forEach((value, key) => {
        const filtered = value.posts.filter((p) => p.id !== id);
        if (filtered.length !== value.posts.length) {
          store.set(key, { ...value, posts: filtered });
          changed = true;
        }
      });
      if (changed) persistFeed(store);
    };

    const clearPendingDelete = (id?: string) => {
      if (!id) return;
      const p = pendingRef.current!;
      if (p.deletes[id] !== undefined) {
        delete p.deletes[id];
        persistPending(p);
      }
    };

    const clearPendingCreate = (id?: string) => {
      if (!id) return;
      const p = pendingRef.current!;
      if (p.creates[id]) {
        delete p.creates[id];
        persistPending(p);
      }
    };

    const unsubscribe = realtimeManager.subscribeToPosts(
      (inserted: any) => clearPendingCreate(inserted?.id),
      (updated: any) => {
        if (updated?.status === "archived" || updated?.status === "deleted") {
          removeFromCaches(updated.id);
          clearPendingDelete(updated.id);
        }
      },
      (deleted: any) => {
        removeFromCaches(deleted?.id);
        clearPendingDelete(deleted?.id);
      }
    );

    return unsubscribe;
  }, []);

  // Periodic pending-state sweep as a failsafe — cap entries at PENDING_TTL.
  useEffect(() => {
    const interval = setInterval(() => {
      const p = pendingRef.current!;
      const now = Date.now();
      let changed = false;
      Object.entries(p.creates).forEach(([id, v]) => {
        if (now - v.createdAt > PENDING_TTL) { delete p.creates[id]; changed = true; }
      });
      Object.entries(p.deletes).forEach(([id, ts]) => {
        if (now - ts > PENDING_TTL) { delete p.deletes[id]; changed = true; }
      });
      if (changed) persistPending(p);
    }, 30 * 1000);
    return () => clearInterval(interval);
  }, []);

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
      trackCreate: (post) => {
        if (!post?.id) return;
        pendingRef.current!.creates[post.id] = { post, createdAt: Date.now() };
        // Clear any stale pending-delete for this id (re-created after deletion).
        delete pendingRef.current!.deletes[post.id];
        persistPending(pendingRef.current!);
      },
      trackDelete: (postId) => {
        if (!postId) return;
        pendingRef.current!.deletes[postId] = Date.now();
        // If user created then immediately deleted, drop the pending create too.
        delete pendingRef.current!.creates[postId];
        persistPending(pendingRef.current!);
      },
      applyOverlay: (posts) => {
        const p = pendingRef.current!;
        const deleteIds = new Set(Object.keys(p.deletes));
        const existingIds = new Set(posts.map((x) => x.id));
        const extras = Object.values(p.creates)
          .filter((v) => !existingIds.has(v.post.id) && !deleteIds.has(v.post.id))
          .sort(
            (a, b) =>
              new Date(b.post.created_at).getTime() -
              new Date(a.post.created_at).getTime()
          )
          .map((v) => v.post);
        return [...extras, ...posts.filter((x) => !deleteIds.has(x.id))];
      },
      applyDeletes: (posts) => {
        const deleteIds = new Set(Object.keys(pendingRef.current!.deletes));
        if (deleteIds.size === 0) return posts;
        return posts.filter((x) => !deleteIds.has(x.id));
      },
      reconcile: (fetched) => {
        const p = pendingRef.current!;
        const fetchedIds = new Set(fetched.map((x) => x.id));
        let changed = false;
        // If a pending create now appears in server data, the server caught up.
        Object.keys(p.creates).forEach((id) => {
          if (fetchedIds.has(id)) { delete p.creates[id]; changed = true; }
        });
        if (changed) persistPending(p);
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
