import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";

/**
 * Beacon 1 alarm ingestion. Called by the device TCP gateway
 * (apps/gateway) when a paired tracker raises an SOS (alarm bit 0) or
 * fall-down (bit 19) alarm. Runs the same fan-out as the in-app SOS
 * button: emergency contacts + everyone within 5 km + admin map, so a
 * hardware SOS is indistinguishable from an app SOS for receivers.
 *
 * Auth: shared secret header from the gateway, never user-facing.
 */

const NEARBY_RADIUS_M = 5000; // matches SOSButton fan-out
const NEARBY_MAX = 200;

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16`,
      {
        headers: { "User-Agent": "peja-app/1.0 (device-sos)" },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    return (data?.display_name as string) || fallback;
  } catch {
    return fallback;
  }
}

export async function POST(req: NextRequest) {
  const expected = process.env.DEVICE_GATEWAY_SECRET;
  if (!expected || req.headers.get("x-gateway-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    device_id?: string;
    kind?: string;
    latitude?: number | null;
    longitude?: number | null;
    battery_pct?: number | null;
    occurred_at?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = payload.kind === "fall" ? "fall" : payload.kind === "sos" ? "sos" : null;
  if (!payload.device_id || !kind) {
    return NextResponse.json({ error: "device_id and kind required" }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: device } = await supabaseAdmin
    .from("devices")
    .select(
      "id, user_id, name, fall_alert_enabled, status, last_lat, last_lng, last_fix_at, active_sos_alert_id"
    )
    .eq("device_id", payload.device_id)
    .maybeSingle();
  if (!device || device.status === "unpaired") {
    return NextResponse.json({ error: "Unknown device" }, { status: 404 });
  }

  // Fall alerts are opt-in (stealth + false-positive policy). The event is
  // still recorded by the gateway; we just don't alert anyone.
  if (kind === "fall" && !device.fall_alert_enabled) {
    return NextResponse.json({ sos_alert_id: null, skipped: "fall_alerts_disabled" });
  }

  // ONE living alert per device: while an alert is still active, any new
  // alarm (SOS re-press, fall during SOS, repeat fall) refreshes it
  // instead of dropping another pin, and nobody gets re-notified.
  if (device.active_sos_alert_id) {
    const { data: existing } = await supabaseAdmin
      .from("sos_alerts")
      .select("id, status")
      .eq("id", device.active_sos_alert_id)
      .eq("status", "active")
      .maybeSingle();
    if (existing) {
      const freshLat = typeof payload.latitude === "number" ? payload.latitude : null;
      const freshLng = typeof payload.longitude === "number" ? payload.longitude : null;
      const patch: Record<string, unknown> = { last_updated: new Date().toISOString() };
      if (freshLat != null && freshLng != null) {
        patch.latitude = freshLat;
        patch.longitude = freshLng;
      }
      await supabaseAdmin.from("sos_alerts").update(patch).eq("id", existing.id);
      return NextResponse.json({
        sos_alert_id: existing.id,
        merged_into_active: true,
        contacts_notified: 0,
        nearby_notified: 0,
      });
    }
  }

  const { data: owner } = await supabaseAdmin
    .from("users")
    .select("id, full_name, status")
    .eq("id", device.user_id)
    .single();
  if (!owner) {
    return NextResponse.json({ error: "Device owner not found" }, { status: 404 });
  }
  const userName = owner.full_name || "Someone";

  // The device often has no GPS fix indoors (its SOS still arrives, just
  // without coordinates). Fall back to the device's last known position;
  // an alert with a slightly stale pin beats a dead alert.
  let lat = typeof payload.latitude === "number" ? payload.latitude : null;
  let lng = typeof payload.longitude === "number" ? payload.longitude : null;
  let freshFix = lat != null && lng != null;
  let staleFix = false;
  if (!freshFix && device.last_lat != null && device.last_lng != null) {
    lat = device.last_lat;
    lng = device.last_lng;
    staleFix = true;
    // "Fresh enough" for the nearby-strangers broadcast: within 15 min.
    freshFix =
      !!device.last_fix_at &&
      Date.now() - new Date(device.last_fix_at).getTime() < 15 * 60 * 1000;
  }

  const address =
    lat != null && lng != null
      ? `${await reverseGeocode(lat, lng)}${staleFix ? " (last known location)" : ""}`
      : "Location not available yet";

  const sourceMessage =
    kind === "sos"
      ? `Triggered from ${device.name || "Beacon 1"} tracker`
      : `Fall detected by ${device.name || "Beacon 1"} tracker`;

  // sos_alerts requires coordinates. With none at all (device never got a
  // fix since pairing), skip the map alert but STILL notify the user's
  // emergency contacts below - never let SOS die silently.
  let sosAlert: { id: string } | null = null;
  if (lat != null && lng != null) {
    const { data, error: insertErr } = await supabaseAdmin
      .from("sos_alerts")
      .insert({
        user_id: device.user_id,
        latitude: lat,
        longitude: lng,
        address,
        status: "active",
        tag: null,
        message: sourceMessage,
      })
      .select("id")
      .single();
    if (insertErr || !data) {
      return NextResponse.json(
        { error: `sos_alerts insert failed: ${insertErr?.message}` },
        { status: 500 }
      );
    }
    sosAlert = data;
    // Remember the living alert so the gateway can move its pin with
    // every location report and repeat alarms merge into it.
    await supabaseAdmin
      .from("devices")
      .update({
        active_sos_alert_id: sosAlert.id,
        sos_escalated_at: null, // fresh alert, fresh escalation budget
        updated_at: new Date().toISOString(),
      })
      .eq("id", device.id);
  }

  const notifData = {
    sos_id: sosAlert?.id ?? null,
    source: "beacon1",
    kind,
    address,
    latitude: lat,
    longitude: lng,
    message: sourceMessage,
  };
  const pushData: Record<string, string> = {
    sos_id: sosAlert ? String(sosAlert.id) : "",
    source: "beacon1",
    kind,
  };

  const title = kind === "sos" ? "SOS Alert: Emergency" : "Fall Alert";
  const contactBody =
    kind === "sos"
      ? sosAlert
        ? `${userName} needs immediate help at ${address}`
        : `${userName} pressed their Beacon SOS. Location not available yet - try calling them now.`
      : `${userName} may have fallen at ${address}`;

  // 1. Accepted emergency contacts only - same rule as the app SOS.
  const { data: contacts } = await supabaseAdmin
    .from("emergency_contacts")
    .select("contact_user_id")
    .eq("user_id", device.user_id)
    .eq("status", "accepted")
    .not("contact_user_id", "is", null);
  const contactIds = (contacts || [])
    .map((c) => c.contact_user_id as string)
    .filter(Boolean);

  // 2. Nearby fan-out: real SOS only, never for falls (decided policy),
  // and only with a fresh-enough fix - broadcasting strangers to a stale
  // location would send help to the wrong place.
  let nearbyIds: string[] = [];
  if (kind === "sos" && freshFix && lat != null && lng != null) {
    const { data: nearby } = await supabaseAdmin.rpc("users_within_radius", {
      lat,
      lng,
      radius_m: NEARBY_RADIUS_M,
      max_results: NEARBY_MAX,
    });
    nearbyIds = ((nearby || []) as Array<{ id: string }>)
      .map((r) => r.id)
      .filter((id) => id && id !== device.user_id && !contactIds.includes(id));
  }

  // The owner gets told too - it's their device, and if it was a false
  // trigger they need to know there's something to cancel.
  const ownerTitle = kind === "sos" ? "Your Beacon sent an SOS" : "Your Beacon detected a fall";
  const ownerBody =
    kind === "sos"
      ? "Your emergency contacts were alerted. If this was a mistake, open Beacon and tap I'm safe."
      : "Your emergency contacts were alerted. If you're okay, open Beacon and cancel the alert.";

  const rows = [
    {
      user_id: device.user_id,
      type: "system",
      title: ownerTitle,
      body: ownerBody,
      data: { ...notifData, self: true },
      is_read: false,
    },
    ...contactIds.map((uid) => ({
      user_id: uid,
      type: "sos_alert",
      title,
      body: contactBody,
      data: notifData,
      is_read: false,
    })),
    ...nearbyIds.map((uid) => ({
      user_id: uid,
      type: "sos_alert",
      title,
      body: `Someone needs help at ${address}`,
      data: notifData,
      is_read: false,
    })),
  ];

  if (rows.length > 0) {
    await supabaseAdmin.from("notifications").insert(rows);
  }
  await Promise.all([
    sendPushToUser({
      userId: device.user_id,
      title: ownerTitle,
      body: ownerBody,
      data: { ...pushData, self: "true" },
    }).catch(() => 0),
    ...contactIds.map((uid) =>
      sendPushToUser({ userId: uid, title, body: contactBody, data: pushData }).catch(() => 0)
    ),
    ...nearbyIds.map((uid) =>
      sendPushToUser({
        userId: uid,
        title,
        body: `Someone needs help at ${address}`,
        data: pushData,
      }).catch(() => 0)
    ),
  ]);

  return NextResponse.json({
    sos_alert_id: sosAlert?.id ?? null,
    contacts_notified: contactIds.length,
    nearby_notified: nearbyIds.length,
  });
}
