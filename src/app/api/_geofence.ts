import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "./_firebaseAdmin";

// Geofence evaluator. One implementation for every subject that reports a
// position: a person on a check-in now, hosted Beacons when the Beacon
// Circle work lands. Runs SERVER SIDE only.
//
// It is called from two directions for the same session:
//   1. /api/checkin/location, the web/iOS ingest route (instant), and
//   2. /api/cron/checkin-monitor, which sweeps active sessions and catches
//      the native Android service's direct-to-Supabase position writes.
// Because the same evidence can therefore be seen twice, all hysteresis is
// wall-clock dwell (pending_since), never fix counting. Evaluating a
// position twice re-reads the same clock and reaches the same answer.
//
// Fence rules:
//   enter: within radius continuously for ENTER_DWELL_MS
//   exit:  beyond radius + EXIT_BUFFER_M continuously for EXIT_DWELL_MS
//   in the ring between the two: no evidence either way, pending clears
//   repeat events for one place: at most one per EVENT_COOLDOWN_MS
// Arrival at a session destination is one shot: arrived_at set once.

const ENTER_DWELL_MS = 45_000;
const EXIT_DWELL_MS = 90_000;
const EXIT_BUFFER_M = 100;
const EVENT_COOLDOWN_MS = 10 * 60_000;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface PlaceRow {
  id: string;
  label: string;
  lat: number;
  lng: number;
  radius_m: number;
}

interface StateRow {
  place_id: string;
  inside: boolean;
  since: string;
  pending_since: string | null;
  last_event_at: string | null;
}

export interface GeofenceSubject {
  /** "user:<id>" or "device:<id>", the geofence_state partition key. */
  subjectKey: string;
  /** Display name used in notification copy ("Funke", "Ada's Beacon"). */
  subjectName: string;
  /** Who gets told. */
  audienceUserIds: string[];
  lat: number;
  lng: number;
}

async function notifyAudience(
  supabaseAdmin: SupabaseClient,
  audience: string[],
  title: string,
  body: string,
  data: Record<string, string>,
) {
  if (audience.length === 0) return;
  await supabaseAdmin.from("notifications").insert(
    audience.map((userId) => ({
      user_id: userId,
      type: "system",
      title,
      body,
      data,
      is_read: false,
    })),
  );
  await Promise.all(
    audience.map((userId) => sendPushToUser({ userId, title, body, data }).catch(() => {})),
  );
}

/**
 * Evaluate every fence for one subject at one position. `places` scoping is
 * the caller's job (a person's own places, or one Beacon's places), so this
 * stays subject-agnostic.
 */
export async function evaluatePlaceFences(
  supabaseAdmin: SupabaseClient,
  subject: GeofenceSubject,
  places: PlaceRow[],
) {
  if (places.length === 0) return;
  const now = Date.now();

  const { data: stateRows } = await supabaseAdmin
    .from("geofence_state")
    .select("place_id, inside, since, pending_since, last_event_at")
    .eq("subject_key", subject.subjectKey)
    .in("place_id", places.map((p) => p.id));
  const stateBy = new Map<string, StateRow>((stateRows || []).map((s: StateRow) => [s.place_id, s]));

  for (const place of places) {
    const dist = haversineM(subject.lat, subject.lng, place.lat, place.lng);
    const state = stateBy.get(place.id) ?? {
      place_id: place.id,
      inside: false,
      since: new Date(now).toISOString(),
      pending_since: null,
      last_event_at: null,
    };

    // Three-zone evidence: inside the radius, outside radius + buffer, or
    // in the ring between (no evidence, the fence line itself is noisy).
    const evidenceInside = dist <= place.radius_m;
    const evidenceOutside = dist > place.radius_m + EXIT_BUFFER_M;

    let flipped = false;
    let pending = state.pending_since;

    if (state.inside) {
      if (evidenceOutside) {
        if (!pending) pending = new Date(now).toISOString();
        else if (now - Date.parse(pending) >= EXIT_DWELL_MS) flipped = true;
      } else if (evidenceInside) {
        pending = null;
      }
    } else {
      if (evidenceInside) {
        if (!pending) pending = new Date(now).toISOString();
        else if (now - Date.parse(pending) >= ENTER_DWELL_MS) flipped = true;
      } else if (evidenceOutside) {
        pending = null;
      }
    }

    if (!flipped && pending === state.pending_since) continue; // nothing changed

    const nextInside = flipped ? !state.inside : state.inside;
    const lastEventMs = state.last_event_at ? Date.parse(state.last_event_at) : 0;
    const shouldNotify = flipped && now - lastEventMs >= EVENT_COOLDOWN_MS;

    await supabaseAdmin.from("geofence_state").upsert(
      {
        subject_key: subject.subjectKey,
        place_id: place.id,
        inside: nextInside,
        since: flipped ? new Date(now).toISOString() : state.since,
        pending_since: flipped ? null : pending,
        last_event_at: shouldNotify ? new Date(now).toISOString() : state.last_event_at,
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "subject_key,place_id" },
    );

    if (shouldNotify) {
      const arrived = nextInside;
      await notifyAudience(
        supabaseAdmin,
        subject.audienceUserIds,
        arrived ? `${subject.subjectName} arrived` : `${subject.subjectName} left`,
        arrived
          ? `${subject.subjectName} arrived at ${place.label}.`
          : `${subject.subjectName} left ${place.label}.`,
        {
          type: arrived ? "geofence_arrival" : "geofence_departure",
          place_id: place.id,
          place_label: place.label,
          subject_key: subject.subjectKey,
        },
      );
    }
  }
}

interface DestinationCheckin {
  id: string;
  destination_place_id: string | null;
  destination_label: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_radius_m: number | null;
  destination_pending_since: string | null;
  arrived_at: string | null;
}

/**
 * One-shot arrival check against a session's destination. Separate from
 * place fences because a pin-drop destination has no places row, and
 * because arrival is announced once and never repeated.
 */
export async function evaluateDestination(
  supabaseAdmin: SupabaseClient,
  subject: GeofenceSubject,
  checkin: DestinationCheckin,
) {
  if (
    checkin.arrived_at ||
    checkin.destination_lat == null ||
    checkin.destination_lng == null
  )
    return;

  const now = Date.now();
  const radius = checkin.destination_radius_m ?? 150;
  const dist = haversineM(subject.lat, subject.lng, checkin.destination_lat, checkin.destination_lng);

  if (dist > radius) {
    // Off target: clear a stale dwell clock so a drive-past never counts.
    if (checkin.destination_pending_since) {
      await supabaseAdmin
        .from("safety_checkins")
        .update({ destination_pending_since: null })
        .eq("id", checkin.id);
    }
    return;
  }

  if (!checkin.destination_pending_since) {
    await supabaseAdmin
      .from("safety_checkins")
      .update({ destination_pending_since: new Date(now).toISOString() })
      .eq("id", checkin.id);
    return;
  }

  if (now - Date.parse(checkin.destination_pending_since) < ENTER_DWELL_MS) return;

  // Arrived. Claim it atomically: the ingest route and the cron can both
  // get here for the same session, and only the writer that flips
  // arrived_at from null announces it.
  const { data: claimed } = await supabaseAdmin
    .from("safety_checkins")
    .update({ arrived_at: new Date(now).toISOString(), destination_pending_since: null })
    .eq("id", checkin.id)
    .is("arrived_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return;

  // If the destination is a saved place, pre-stamp that place's fence as
  // inside-and-just-announced, so the generic place fence does not fire a
  // second "arrived at" for the same doorstep a minute later.
  if (checkin.destination_place_id) {
    await supabaseAdmin.from("geofence_state").upsert(
      {
        subject_key: subject.subjectKey,
        place_id: checkin.destination_place_id,
        inside: true,
        since: new Date(now).toISOString(),
        pending_since: null,
        last_event_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "subject_key,place_id" },
    );
  }

  const label = checkin.destination_label || "their destination";
  await notifyAudience(
    supabaseAdmin,
    subject.audienceUserIds,
    `${subject.subjectName} arrived`,
    `${subject.subjectName} arrived at ${label}.`,
    {
      type: "destination_arrival",
      checkin_id: checkin.id,
      place_label: label,
      subject_key: subject.subjectKey,
    },
  );
}

/**
 * Everyone who should hear about one hosted Beacon: the host, every
 * granted viewer, and (when Beacon sharing is on) the host's accepted
 * emergency contacts minus the individually hidden ones. This is the
 * same audience that sees the device on the map, which is the honest
 * rule: fence events go exactly to the people who can already watch
 * the dot move.
 */
export async function beaconAudience(
  supabaseAdmin: SupabaseClient,
  device: {
    id: string;
    user_id: string;
    share_with_contacts: boolean | null;
  },
): Promise<string[]> {
  const audience = new Set<string>([device.user_id]);

  const { data: grants } = await supabaseAdmin
    .from("beacon_viewers")
    .select("viewer_user_id")
    .eq("device_id", device.id);
  for (const g of grants || []) audience.add(g.viewer_user_id as string);

  if (device.share_with_contacts !== false) {
    const [{ data: contacts }, { data: hidden }] = await Promise.all([
      supabaseAdmin
        .from("emergency_contacts")
        .select("contact_user_id")
        .eq("user_id", device.user_id)
        .eq("status", "accepted"),
      supabaseAdmin
        .from("device_hidden_contacts")
        .select("contact_user_id")
        .eq("device_id", device.id),
    ]);
    const hiddenSet = new Set((hidden || []).map((h) => h.contact_user_id as string));
    for (const c of contacts || []) {
      const id = c.contact_user_id as string | null;
      if (id && !hiddenSet.has(id)) audience.add(id);
    }
  }

  return Array.from(audience);
}

/**
 * Fence pass for every hosted Beacon that has places and a fresh fix.
 * Called from the checkin-monitor cron (positions arrive via the TCP
 * gateway, which writes straight to Supabase, so no API route ever sees
 * them). Returns how many devices were evaluated.
 */
export async function evaluateBeaconGeofences(supabaseAdmin: SupabaseClient): Promise<number> {
  // Only devices that actually have fences: places drive the work.
  const { data: devicePlaces } = await supabaseAdmin
    .from("places")
    .select("device_id")
    .not("device_id", "is", null);
  const deviceIds = Array.from(
    new Set((devicePlaces || []).map((p) => p.device_id as string)),
  );
  if (deviceIds.length === 0) return 0;

  const freshCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: devices } = await supabaseAdmin
    .from("devices")
    .select("id, user_id, name, wearer_name, share_with_contacts, last_lat, last_lng, last_fix_at")
    .in("id", deviceIds)
    .neq("status", "unpaired")
    .gte("last_fix_at", freshCutoff)
    .not("last_lat", "is", null);

  let evaluated = 0;
  for (const device of devices || []) {
    const { data: places } = await supabaseAdmin
      .from("places")
      .select("id, label, lat, lng, radius_m")
      .eq("device_id", device.id);
    if (!places || places.length === 0) continue;

    const audience = await beaconAudience(supabaseAdmin, device);
    await evaluatePlaceFences(
      supabaseAdmin,
      {
        subjectKey: `device:${device.id}`,
        subjectName: (device.wearer_name as string) || (device.name as string) || "The Beacon",
        audienceUserIds: audience,
        lat: device.last_lat as number,
        lng: device.last_lng as number,
      },
      places as PlaceRow[],
    );
    evaluated++;
  }
  return evaluated;
}

/**
 * Convenience wrapper for the person-on-a-check-in subject: loads the
 * user's own places and runs both destination and place fences.
 */
export async function evaluateUserGeofences(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    userName: string;
    audienceUserIds: string[];
    lat: number;
    lng: number;
    checkin: DestinationCheckin;
  },
) {
  const subject: GeofenceSubject = {
    subjectKey: `user:${params.userId}`,
    subjectName: params.userName,
    audienceUserIds: params.audienceUserIds,
    lat: params.lat,
    lng: params.lng,
  };

  const { data: places } = await supabaseAdmin
    .from("places")
    .select("id, label, lat, lng, radius_m")
    .eq("owner_user_id", params.userId)
    .is("device_id", null);

  // Destination first: "arrived at School" beats a generic fence event for
  // the same spot, and the cooldown on the place fence then swallows the
  // duplicate that would otherwise follow.
  await evaluateDestination(supabaseAdmin, subject, params.checkin);
  await evaluatePlaceFences(supabaseAdmin, subject, (places as PlaceRow[]) || []);
}
