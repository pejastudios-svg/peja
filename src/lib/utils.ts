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

/**
 * Compact count formatting for stat rows (views, confirmations, comments).
 * 999 -> "999", 1500 -> "1.5K", 1000000 -> "1M". Keeps a viral post's counts
 * from blowing out the fixed-width action row.
 */
export function formatCount(n: number | null | undefined): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  if (v < 1000) return String(v);
  if (v < 1_000_000) {
    const k = v / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  const m = v / 1_000_000;
  return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
}