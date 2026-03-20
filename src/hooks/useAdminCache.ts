"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePageCache } from "@/context/PageCacheContext";

/**
 * useAdminCache - Stale-while-revalidate caching for admin pages
 * 
 * Usage:
 *   const { data, loading, refresh } = useAdminCache("admin:users", fetchUsers);
 * 
 * - First visit: shows skeleton (loading=true), fetches data, caches it
 * - Revisit: shows cached data instantly (loading=false), fetches fresh in background
 * - Manual refresh: fetches fresh data without showing skeleton
 * 
 * @param key - Unique cache key for this page/data
 * @param fetcher - Async function that returns the data
 * @param opts - Options: maxAge (ms before refetch, default 60s), deps (refetch triggers)
 */
export function useAdminCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts?: { maxAge?: number; deps?: any[] }
) {
  const cache = usePageCache();
  const maxAge = opts?.maxAge ?? 60000; // 1 minute default
  const deps = opts?.deps ?? [];

  const cached = cache.get<T>(key);
  const [data, setData] = useState<T | null>(cached);
  const [loading, setLoading] = useState(cached === null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);

  const doFetch = useCallback(async (silent = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
        cache.set(key, result);
      }
    } catch {
      // Keep cached data on error
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      fetchingRef.current = false;
    }
  }, [key, fetcher, cache]);

  // On mount: use cache or fetch
  useEffect(() => {
    mountedRef.current = true;

    const entry = cache.getWithAge<T>(key);
    if (entry) {
      // Show cached data immediately
      setData(entry.data);
      setLoading(false);

      // Revalidate in background if stale
      if (entry.ageMs > maxAge) {
        doFetch(true);
      }
    } else {
      // No cache, full fetch
      doFetch(false);
    }

    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Refetch when deps change (filter/tab changes)
  const depsKey = JSON.stringify(deps);
  const prevDepsRef = useRef(depsKey);

  useEffect(() => {
    if (prevDepsRef.current !== depsKey) {
      prevDepsRef.current = depsKey;
      // Check for cached version of new deps combo
      const depKey = `${key}:${depsKey}`;
      const depEntry = cache.getWithAge<T>(depKey);
      if (depEntry && depEntry.ageMs < maxAge) {
        setData(depEntry.data);
        setLoading(false);
      } else {
        doFetch(data !== null); // silent if we have any data
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  // Save dep-specific cache
  useEffect(() => {
    if (data !== null && deps.length > 0) {
      const depKey = `${key}:${depsKey}`;
      cache.set(depKey, data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, depsKey]);

  const refresh = useCallback(() => doFetch(true), [doFetch]);

  return { data, loading, refreshing, refresh, setData };
}