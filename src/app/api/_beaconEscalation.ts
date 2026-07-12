import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "./_firebaseAdmin";

// A Beacon SOS that stays active this long...
const ESCALATE_AFTER_HOURS = 2;
// ...with no position change for this long (victim immobile, device dead
// or out of coverage) gets one more round of contact notifications.
const STALE_MINUTES = 30;

/**
 * Called from the checkin-monitor cron (every minute). Two jobs:
 *  1. Housekeeping: clear devices.active_sos_alert_id when the linked
 *     alert was resolved elsewhere (admin panel, app) so dashboards and
 *     the gateway stop tracking it.
 *  2. Escalation: re-notify emergency contacts ONCE about a long-running,
 *     motionless Beacon SOS nobody has cancelled.
 */
export async function escalateStaleBeaconSos(supabaseAdmin: SupabaseClient): Promise<number> {
  const { data: devices } = await supabaseAdmin
    .from("devices")
    .select("id, user_id, name, active_sos_alert_id, sos_escalated_at")
    .not("active_sos_alert_id", "is", null)
    .limit(200);
  if (!devices || devices.length === 0) return 0;

  const alertIds = devices.map((d) => d.active_sos_alert_id as string);
  const { data: alerts } = await supabaseAdmin
    .from("sos_alerts")
    .select("id, status, created_at, last_updated, address")
    .in("id", alertIds);
  const alertById = new Map((alerts || []).map((a) => [a.id, a]));

  const now = Date.now();
  let escalated = 0;

  for (const device of devices) {
    const alert = alertById.get(device.active_sos_alert_id as string);

    // 1. Alert gone or resolved -> unlink so tracking stops everywhere.
    if (!alert || alert.status !== "active") {
      await supabaseAdmin
        .from("devices")
        .update({ active_sos_alert_id: null, sos_escalated_at: null })
        .eq("id", device.id);
      continue;
    }

    if (device.sos_escalated_at) continue; // already escalated once

    const ageMs = now - new Date(alert.created_at).getTime();
    if (ageMs < ESCALATE_AFTER_HOURS * 60 * 60 * 1000) continue;

    const lastMoveMs = alert.last_updated
      ? now - new Date(alert.last_updated).getTime()
      : Infinity;
    if (lastMoveMs < STALE_MINUTES * 60 * 1000) continue; // still moving/reporting

    // Claim the escalation first (guard vs overlapping cron runs).
    const { data: claimed } = await supabaseAdmin
      .from("devices")
      .update({ sos_escalated_at: new Date().toISOString() })
      .eq("id", device.id)
      .is("sos_escalated_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const { data: owner } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", device.user_id)
      .single();
    const userName = owner?.full_name || "Your contact";
    const hours = Math.floor(ageMs / (60 * 60 * 1000));

    const { data: contacts } = await supabaseAdmin
      .from("emergency_contacts")
      .select("contact_user_id")
      .eq("user_id", device.user_id)
      .eq("status", "accepted")
      .not("contact_user_id", "is", null);
    const contactIds = (contacts || [])
      .map((c) => c.contact_user_id as string)
      .filter(Boolean);
    if (contactIds.length === 0) continue;

    const title = "SOS Still Active";
    const body =
      `${userName}'s Beacon SOS has been active for over ${hours} hour${hours === 1 ? "" : "s"} ` +
      `and hasn't moved recently. Last seen at ${alert.address || "an unknown location"}. ` +
      `Please check on them.`;
    const data = { sos_id: alert.id, type: "beacon_sos_escalation" };

    await supabaseAdmin.from("notifications").insert(
      contactIds.map((uid) => ({
        user_id: uid,
        type: "sos_alert",
        title,
        body,
        data,
        is_read: false,
      }))
    );
    await Promise.all(
      contactIds.map((uid) =>
        sendPushToUser({
          userId: uid,
          title,
          body,
          data: { sos_id: String(alert.id), type: "beacon_sos_escalation" },
        }).catch(() => 0)
      )
    );
    escalated++;
  }

  return escalated;
}
