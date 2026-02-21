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