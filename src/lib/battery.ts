// Battery level via the (Chromium-only) Battery Status API.
// Safari/Firefox return null; callers treat null as "unknown" and keep
// whatever the presence row already holds.

interface BatteryManagerLike { level: number }
interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

export async function batteryPct(): Promise<number | null> {
  try {
    const nav = navigator as NavigatorWithBattery;
    if (!nav.getBattery) return null;
    const b = await nav.getBattery();
    return Math.round(b.level * 100);
  } catch {
    return null;
  }
}
