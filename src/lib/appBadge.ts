// App-icon badge (the little red count on the icon). Works on iOS 16.4+
// Home Screen web apps and installed Android PWAs; silently a no-op
// everywhere else. The service worker keeps it updated while the app is
// closed (from push payloads); these helpers keep it honest while open.
export function setAppBadgeCount(count: number): void {
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;
    if (count > 0) nav.setAppBadge(Math.min(count, 99)).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  } catch {}
}
