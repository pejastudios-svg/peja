// Unified offline storage — cache data and queue pending actions in localStorage.

const PREFIX = "peja-offline";

// ─── Data cache ────────────────────────────────────────────────────────────

export function saveToCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(`${PREFIX}-cache-${key}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export function loadFromCache<T>(key: string, maxAgeMs = 24 * 60 * 60 * 1000): T | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}-cache-${key}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > maxAgeMs) return null;
    return data as T;
  } catch {
    return null;
  }
}

export function clearCache(key: string): void {
  try {
    localStorage.removeItem(`${PREFIX}-cache-${key}`);
  } catch {}
}

// ─── Action queue ───────────────────────────────────────────────────────────

export function enqueueAction(namespace: string, action: object): void {
  try {
    const key = `${PREFIX}-queue-${namespace}`;
    const queue: any[] = JSON.parse(localStorage.getItem(key) || "[]");
    queue.push({ ...action, _queuedAt: Date.now() });
    localStorage.setItem(key, JSON.stringify(queue));
  } catch {}
}

export function getQueue(namespace: string): any[] {
  try {
    return JSON.parse(localStorage.getItem(`${PREFIX}-queue-${namespace}`) || "[]");
  } catch {
    return [];
  }
}

export function dequeueAction(namespace: string, index: number): void {
  try {
    const key = `${PREFIX}-queue-${namespace}`;
    const queue: any[] = JSON.parse(localStorage.getItem(key) || "[]");
    queue.splice(index, 1);
    localStorage.setItem(key, JSON.stringify(queue));
  } catch {}
}

export function clearQueue(namespace: string): void {
  try {
    localStorage.removeItem(`${PREFIX}-queue-${namespace}`);
  } catch {}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/** Run a callback once when the browser comes back online. */
export function onNextOnline(cb: () => void): () => void {
  const handler = () => { cb(); window.removeEventListener("online", handler); };
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
}
