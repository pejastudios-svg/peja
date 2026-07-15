// Position filter: the difference between "renders every raw fix" and
// "tracks like Google Maps". Android hands us a mix of GPS (~10m),
// Wi-Fi (~40m) and cell-tower (~500-2000m) fixes; in weak-GPS areas
// (dense Lagos neighborhoods) the source flips constantly and raw
// rendering teleports the user all over the map. Three disciplines fix
// most of it:
//
//   1. GATE: fixes claiming worse than ~150m accuracy are junk unless
//      we've been blind for a while (stale-good beats fresh-garbage,
//      but never go fully dark in an emergency).
//   2. TELEPORT REJECTION: a fix implying >300 km/h is noise until a
//      second fix agrees (then it's a real relocation: accept it).
//   3. KALMAN BLEND: accuracy-weighted smoothing. A 20m fix moves the
//      estimate a lot; a 300m fix barely nudges it. The classic
//      single-state GPS Kalman: variance grows with time, each fix
//      pulls proportionally to how much it's trusted.
//
// One filter instance per tracking session (it carries state).

import { haversineM } from "./motion";

// Fixes worse than this are ignored while we have something better.
const SOFT_ACCURACY_M = 150;
// Fixes worse than this are never trusted, even blind.
const HARD_ACCURACY_M = 800;
// After this long with no accepted fix, accept a degraded (soft-gated)
// fix rather than showing nothing.
const BLIND_MS = 60_000;
// Desperation valve: after this long fully blind, even a hard-gated
// coarse fix passes (a safety app must never go silent while the phone
// still knows SOMETHING). 5km+ claims stay out - those are noise.
const HARD_BLIND_MS = 180_000;
// Implied speed above this is a teleport, pending confirmation.
const TELEPORT_KMH = 300;
// A pending teleport is confirmed when the next fix lands within this
// distance of it (the phone really did relocate: tunnel exit, app
// reopen after a drive, etc.).
const TELEPORT_CONFIRM_M = 150;
// Kalman process noise: how fast we assume a person can drift (m/s).
// Higher = snappier response, lower = smoother. 4 m/s covers city
// driving between fixes without lagging badly.
const PROCESS_NOISE_MS = 4;

export interface FilteredFix {
  lat: number;
  lng: number;
  /** Effective accuracy of the ESTIMATE in meters (post-blend). */
  accuracyM: number;
  /** True when we're running on degraded (soft-gated) fixes. */
  approximate: boolean;
}

export function createPositionFilter() {
  let est: { lat: number; lng: number; varM2: number; t: number } | null = null;
  let lastAcceptedAt = 0;
  let pendingJump: { lat: number; lng: number } | null = null;

  /** Returns the filtered position, or null when the fix was rejected. */
  return function filter(pos: GeolocationPosition): FilteredFix | null {
    const { latitude: lat, longitude: lng } = pos.coords;
    const acc = pos.coords.accuracy ?? 100;
    const now = pos.timestamp || Date.now();

    // Never trust the worst junk (distant cell towers)... unless we've
    // been fully blind for minutes. Then a coarse fix with HONEST
    // accuracy beats silence: reset the estimate (blending stale + junk
    // helps no one) and mark it approximate.
    if (acc > HARD_ACCURACY_M) {
      if (Date.now() - lastAcceptedAt < HARD_BLIND_MS || acc > 5000) return null;
      est = { lat, lng, varM2: acc * acc, t: now };
      lastAcceptedAt = Date.now();
      pendingJump = null;
      return { lat, lng, accuracyM: acc, approximate: true };
    }

    const blind = Date.now() - lastAcceptedAt > BLIND_MS;

    // Soft gate: ignore coarse fixes while we have something better.
    if (est && acc > SOFT_ACCURACY_M && !blind) return null;

    // First fix: take the best we can get and start estimating.
    if (!est) {
      est = { lat, lng, varM2: acc * acc, t: now };
      lastAcceptedAt = Date.now();
      return { lat, lng, accuracyM: acc, approximate: acc > SOFT_ACCURACY_M };
    }

    // Teleport rejection: an impossible jump is noise until it repeats.
    const dt = Math.max(0.001, (now - est.t) / 1000);
    const dist = haversineM(est, { lat, lng });
    const impliedKmh = (dist / dt) * 3.6;
    if (impliedKmh > TELEPORT_KMH) {
      if (pendingJump && haversineM(pendingJump, { lat, lng }) < TELEPORT_CONFIRM_M) {
        // Two agreeing fixes far away: a REAL relocation. Reset there.
        est = { lat, lng, varM2: acc * acc, t: now };
        pendingJump = null;
        lastAcceptedAt = Date.now();
        return { lat, lng, accuracyM: acc, approximate: acc > SOFT_ACCURACY_M };
      }
      pendingJump = { lat, lng };
      return null;
    }
    pendingJump = null;

    // Kalman blend: grow uncertainty with elapsed time, then pull toward
    // the fix in proportion to relative trust.
    est.varM2 += dt * PROCESS_NOISE_MS * PROCESS_NOISE_MS;
    const k = est.varM2 / (est.varM2 + acc * acc);
    est.lat += k * (lat - est.lat);
    est.lng += k * (lng - est.lng);
    est.varM2 *= 1 - k;
    est.t = now;
    lastAcceptedAt = Date.now();

    return {
      lat: est.lat,
      lng: est.lng,
      accuracyM: Math.sqrt(est.varM2),
      approximate: acc > SOFT_ACCURACY_M,
    };
  };
}
