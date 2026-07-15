// Motion engine for the live map: speed, heading, stillness, speeding.
// One implementation shared by MapHome (map open) and CheckInMonitor
// (active SML session) so the two can never disagree.

// Speeding threshold: 100 km/h, the Nigerian expressway limit for cars
// (built-up areas are 50, highways 80). Above this we warn the driver
// and their circle. GPS spikes are filtered by requiring two consecutive
// readings over the limit.
export const SPEEDING_KMH = 100;
// Show a speed badge from here up (below this it's noise: walking pace
// and GPS jitter).
export const BADGE_MIN_KMH = 8;
// Below this the device counts as not moving (starts the stillness clock).
export const STILL_KMH = 2;
// "Still" is only shown after this long without meaningful movement.
export const STILL_AFTER_MS = 60_000;
// Device-wide speeding-alert cooldown (shared between MapHome and the
// SML tracker via localStorage so they never double-fire).
const SPEED_ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const SPEED_ALERT_KEY = "peja-speeding-alerted-at";

export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface MotionSample {
  /** Smoothed speed in km/h; null until enough data. */
  speedKmh: number | null;
  /** Degrees clockwise from north; null when unknown. */
  heading: number | null;
  /** ISO timestamp since when the device has been still; null if moving. */
  stillSince: string | null;
  /** True exactly once per sustained speeding episode (cooldown-gated). */
  speedingTrigger: boolean;
}

/**
 * Feed successive GeolocationPositions, get smoothed motion back.
 * Prefers the GPS chipset's own speed/heading; falls back to deriving
 * speed from successive fixes when the platform reports null.
 */
export function createMotionTracker() {
  let lastFix: { lat: number; lng: number; t: number } | null = null;
  let smoothed: number | null = null;
  // Stillness anchor: the last spot the device MEANINGFULLY moved from.
  // Anchor-based (not speed-based) so it works from the very first fix
  // (desktops may never fire a second one while parked) and survives GPS
  // jitter that fakes brief speed spikes.
  let anchor: { lat: number; lng: number; t: number } | null = null;
  let overCount = 0;

  return function feed(pos: GeolocationPosition): MotionSample {
    const { latitude: lat, longitude: lng, speed, heading, accuracy } = pos.coords;
    const now = pos.timestamp || Date.now();

    // Raw speed: chipset first (m/s), derived second.
    let raw: number | null = null;
    if (speed != null && speed >= 0) {
      raw = speed * 3.6;
    } else if (lastFix) {
      const dt = (now - lastFix.t) / 1000;
      // Need a sane window and decent accuracy or the derivative is noise.
      if (dt >= 1 && dt <= 60 && (accuracy == null || accuracy < 100)) {
        raw = (haversineM(lastFix, { lat, lng }) / dt) * 3.6;
      }
    }
    lastFix = { lat, lng, t: now };

    // Discard physically implausible readings (GPS teleports).
    if (raw != null && raw > 300) raw = null;

    // Light exponential smoothing so the badge doesn't flicker.
    if (raw != null) smoothed = smoothed == null ? raw : smoothed * 0.6 + raw * 0.4;

    // Stillness: moved more than ~30m from the anchor -> new anchor.
    // still_since is simply the anchor's timestamp; viewers only surface
    // it once it's older than STILL_AFTER_MS, so it's always safe to set.
    if (!anchor || haversineM(anchor, { lat, lng }) > 30) {
      anchor = { lat, lng, t: now };
    }
    const stillSince = new Date(anchor.t).toISOString();

    // Speeding: two consecutive over-limit readings + device-wide cooldown.
    let speedingTrigger = false;
    if (smoothed != null && smoothed > SPEEDING_KMH) {
      overCount += 1;
      if (overCount >= 2) {
        let last = 0;
        try { last = Number(localStorage.getItem(SPEED_ALERT_KEY) || 0); } catch {}
        if (Date.now() - last > SPEED_ALERT_COOLDOWN_MS) {
          try { localStorage.setItem(SPEED_ALERT_KEY, String(Date.now())); } catch {}
          speedingTrigger = true;
        }
      }
    } else {
      overCount = 0;
    }

    return {
      speedKmh: smoothed,
      heading: heading != null && !Number.isNaN(heading) && (smoothed ?? 0) > 3 ? heading : null,
      stillSince,
      speedingTrigger,
    };
  };
}

/** Viewer-side helper: "Here for 4m" label, or null if not still enough. */
export function stillLabel(stillSince: string | null | undefined): string | null {
  if (!stillSince) return null;
  const ms = Date.now() - new Date(stillSince).getTime();
  if (ms < STILL_AFTER_MS) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `Here for ${mins}m`;
  return `Here for ${Math.floor(mins / 60)}h`;
}
