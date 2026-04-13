// Offline action queue - queue network requests when offline, replay when back online

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

export async function queueOfflineAction(action: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return false;

  navigator.serviceWorker.controller.postMessage({
    type: "queue-action",
    action,
  });
  return true;
}

export async function replayOfflineQueue() {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage("replay-queue");

  // Also try Background Sync API
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.ready;
    if ("sync" in reg) {
      try {
        await (reg as any).sync.register("peja-offline-sync");
      } catch {}
    }
  }
}

// Auto-replay when coming back online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    setTimeout(() => replayOfflineQueue(), 2000);
  });
}