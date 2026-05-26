// SOS outbox handler. Fires when the drain replays a `sos-log` item
// that was queued while the user was offline. By this point the SMS
// to emergency contacts has already gone out via the device's native
// Messages app (carrier-billed, not Peja). What's left is to:
//
//   1. Write the matching sos_alerts row so the alert shows up on the
//      map / dashboard / admin queue, with the ORIGINAL triggered_at
//      preserved so timestamps reflect when the user actually needed
//      help (not when the drain happened to run).
//   2. Trigger the email fan-out (Apps Script webhook) — most likely
//      the recipients ALSO get the SMS, but email gives them a more
//      detailed record. Idempotent enough that double-delivery is OK.
//   3. Notify nearby users via push/in-app. They were skipped at SOS
//      press time because we were offline.
//
// We deliberately SKIP the in-app/push notification to emergency
// contacts here — they already got the SMS, and re-pinging them via
// FCM would feel like spam.

import { supabase } from "../supabase";
import { apiUrl } from "../api";
import { createNotification } from "../notifications";
import { SOS_TAGS } from "../types";
import type { SosLogPayload } from "../outbox";

export async function dispatchSosLog(payload: SosLogPayload): Promise<void> {
  const tagInfo = payload.tag
    ? SOS_TAGS.find((t) => t.id === payload.tag)
    : null;

  // 1. Insert the sos_alerts row. Pass created_at explicitly so the
  //    timestamp matches when the user pressed SOS, not when the
  //    drain fired. If insert fails (RLS, schema, etc.), throw so
  //    the drain bumps attempts and tries again later.
  const { data: sosData, error: insertErr } = await supabase
    .from("sos_alerts")
    .insert({
      user_id: payload.user_id,
      latitude: payload.latitude,
      longitude: payload.longitude,
      address: payload.address,
      status: "active",
      tag: payload.tag,
      message: payload.message,
      voice_note_url: payload.voice_note_url,
      created_at: payload.triggered_at,
    })
    .select("id")
    .single();

  if (insertErr) {
    throw new Error(`sos_alerts insert failed: ${insertErr.message}`);
  }
  if (!sosData?.id) {
    throw new Error("sos_alerts insert returned no id");
  }

  const sosId = sosData.id as string;

  // 2. Trigger email fan-out — same endpoint the online path calls.
  //    Fire-and-forget: a failure here doesn't invalidate the insert,
  //    so we don't throw and force a retry. Worst case the email
  //    digest is missed but the alert is still recorded.
  try {
    const { data: auth } = await supabase.auth.getSession();
    const token = auth.session?.access_token;
    if (token) {
      await fetch(apiUrl("/api/sos/send-emails"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sosId }),
      });
    }
  } catch (e) {
    console.warn("[outbox/sos] email fan-out failed (non-fatal)", e);
  }

  // 3. Notify nearby users (5km radius). Same RPC + createNotification
  //    flow as the online path. Skipped for emergency contacts because
  //    they already received the SMS at press time.
  if (payload.latitude != null && payload.longitude != null) {
    try {
      const { data: nearby } = await supabase.rpc("users_within_radius", {
        lat: payload.latitude,
        lng: payload.longitude,
        radius_m: 5000,
        max_results: 200,
      });

      const nearbyIds = ((nearby as Array<{ id: string }> | null) || [])
        .map((r) => r.id)
        .filter((id) => id && id !== payload.user_id);

      for (const uid of nearbyIds) {
        await createNotification({
          userId: uid,
          type: "sos_alert",
          title: `SOS Alert: ${tagInfo?.label || "Emergency"}`,
          body: `Someone needs help at ${payload.address || "an unknown location"}`,
          data: {
            sos_id: sosId,
            tag: payload.tag,
            message: payload.message,
            address: payload.address,
            latitude: payload.latitude,
            longitude: payload.longitude,
          },
        });
      }
    } catch (e) {
      console.warn("[outbox/sos] nearby fan-out failed (non-fatal)", e);
    }
  }
}
