// src/lib/utils.ts

/**
 * Creates an abortable fetch wrapper with timeout
 */
export function createAbortableRequest(timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timeoutId);
      controller.abort();
    },
    clearTimeout: () => clearTimeout(timeoutId),
  };
}

/**
 * Appends Supabase Storage image transform params to a URL.
 * Only works with Supabase Storage public URLs.
 * Falls back to original URL for non-Supabase URLs.
 */
export function optimizeAvatarUrl(url: string | null | undefined, size: number = 80): string | null {
  if (!url) return null;
  
  // Only transform Supabase Storage URLs
  if (!url.includes('supabase.co/storage/')) return url;
  
  // Supabase image transforms: /render/image/public/bucket/path?width=X&height=X
  // But this requires the Pro plan. For free plan, just return as-is.
  // Instead, we can add cache headers by using the URL as-is but ensuring
  // the browser caches it.
  return url;
}

/**
 * Safe state updater - only updates if component is mounted
 */
export function createSafeUpdater<T>(
  isMountedRef: React.MutableRefObject<boolean>,
  setState: React.Dispatch<React.SetStateAction<T>>
) {
  return (value: T | ((prev: T) => T)) => {
    if (isMountedRef.current) {
      setState(value);
    }
  };
}

/**
 * Delay utility
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));