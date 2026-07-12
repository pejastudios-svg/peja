import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser, sendSilentDataToUser } from "../../_firebaseAdmin";
import { escalateStaleBeaconSos } from "../../_beaconEscalation";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const queryToken = req.nextUrl.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  const authorized =
    (expected && authHeader === `Bearer ${expected}`) ||
    (expected && queryToken === expected);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const now = new Date();
  let warned = 0;
  let missed = 0;
  let revived = 0;

  // Cap rows processed per run so a large backlog can't blow the function
  // timeout and silently drop the tail. The cron runs every minute (see
  // vercel.json), so anything not handled this pass is picked up next pass.
  const BATCH = 500;

  // --- 1. WARN: active check-ins expiring in < 5 minutes ---
  const warnCutoff = new Date(now.getTime() + 5 * 60 * 1000);

  const { data: expiringSoon } = await supabaseAdmin
    .from("safety_checkins")
    .select("id, user_id, next_check_in_at, last_confirmed_at")
    .eq("status", "active")
    .lt("next_check_in_at", warnCutoff.toISOString())
    .gt("next_check_in_at", now.toISOString())
    .limit(BATCH);

  for (const checkin of expiringSoon || []) {
    // Dedup: only warn once per interval since last confirmation.
    // Use .limit(1) instead of .maybeSingle() to avoid error on multiple rows.
    let warnQuery = supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("user_id", checkin.user_id)
      .filter("data->>type", "eq", "safety_checkin_warning")
      .filter("data->>checkin_id", "eq", checkin.id)
      .limit(1);

    if (checkin.last_confirmed_at) {
      warnQuery = warnQuery.gte("created_at", checkin.last_confirmed_at) as any;
    }

    const { data: existingWarns } = await warnQuery;
    if (existingWarns && existingWarns.length > 0) continue;

    // Fire both DB insert and push in parallel to stay within timeout
    await Promise.all([
      supabaseAdmin.from("notifications").insert({
        user_id: checkin.user_id,
        type: "system",
        title: "Check-In Expiring Soon",
        body: "Your safety check-in expires in less than 5 minutes. Tap 'I'm OK' to reset the timer.",
        data: { type: "safety_checkin_warning", checkin_id: checkin.id },
        is_read: false,
      }),
      sendPushToUser({
        userId: checkin.user_id,
        title: "Check-In Expiring Soon",
        body: "Your safety check-in expires in less than 5 minutes. Tap 'I'm OK' to reset the timer.",
        data: { type: "safety_checkin_warning", checkin_id: checkin.id },
      }).catch(() => {}),
    ]);

    warned++;
  }

  // --- 2. MISSED: active check-ins past their deadline ---
  const { data: overdueCheckins } = await supabaseAdmin
    .from("safety_checkins")
    .select("*")
    .eq("status", "active")
    .lt("next_check_in_at", now.toISOString())
    .limit(BATCH);

  // Phase 1: flip each overdue row to "missed" under the status='active'
  // guard (in parallel), keeping only the ones we actually won.
  const flipped = await Promise.all(
    (overdueCheckins || []).map(async (checkin) => {
      const newMissedCount = (checkin.missed_count || 0) + 1;
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("safety_checkins")
        .update({
          status: "missed",
          missed_count: newMissedCount,
          updated_at: now.toISOString(),
        })
        .eq("id", checkin.id)
        .eq("status", "active")
        // Re-check the deadline in the UPDATE itself. If the user tapped
        // "I'm OK" between our SELECT and this UPDATE, confirm pushed
        // next_check_in_at into the future, so this no longer matches and we
        // don't fire a false "missed check-in" alert to their contacts.
        .lt("next_check_in_at", now.toISOString())
        .select("id");
      // No row updated → we lost the race to a confirm (or another worker).
      if (updateError || !updated || updated.length === 0) return null;
      return { checkin, newMissedCount };
    })
  );
  const won = flipped.filter(
    (x): x is { checkin: any; newMissedCount: number } => x !== null
  );

  if (won.length > 0) {
    // Phase 2: resolve all names in ONE query instead of one per check-in.
    const ownerIds = Array.from(new Set(won.map((w) => w.checkin.user_id)));
    const { data: owners } = await supabaseAdmin
      .from("users")
      .select("id, full_name")
      .in("id", ownerIds);
    const nameById = new Map(
      (owners || []).map((u: { id: string; full_name: string | null }) => [u.id, u.full_name])
    );

    // Phase 3: build every notification row up front and insert them all in
    // ONE call, then fire pushes in parallel. No per-check-in await chain.
    const rows: any[] = [];
    const pushes: Promise<any>[] = [];
    for (const { checkin, newMissedCount } of won) {
      const userName = nameById.get(checkin.user_id) || "Your contact";
      const contactIds: string[] = checkin.contact_ids || [];
      const missedBody = `${userName} missed their check-in. Try reaching out to them. Their location is still being shared.`;

      for (const contactId of contactIds) {
        rows.push({
          user_id: contactId,
          type: "system",
          title: "Missed Check-In",
          body: missedBody,
          data: {
            type: "safety_checkin_missed",
            checkin_id: checkin.id,
            user_id: checkin.user_id,
            user_name: userName,
            missed_count: String(newMissedCount),
          },
          is_read: false,
        });
        pushes.push(
          sendPushToUser({
            userId: contactId,
            title: "Missed Check-In",
            body: missedBody,
            data: { type: "safety_checkin_missed", checkin_id: checkin.id, user_id: checkin.user_id },
          }).catch(() => {})
        );
      }

      rows.push({
        user_id: checkin.user_id,
        type: "system",
        title: "Check-In Expired",
        body: "Your safety check-in timer has expired. Your emergency contacts have been notified. Open Peja and tap 'I'm OK' to confirm you're safe.",
        data: { type: "safety_checkin_self_expired", checkin_id: checkin.id },
        is_read: false,
      });
      pushes.push(
        sendPushToUser({
          userId: checkin.user_id,
          title: "Check-In Expired",
          body: "Your safety check-in timer has expired. Your emergency contacts have been notified. Open Peja and tap 'I'm OK' to confirm you're safe.",
          data: { type: "safety_checkin_self_expired", checkin_id: checkin.id },
        }).catch(() => {})
      );
    }

    if (rows.length > 0) {
      await supabaseAdmin.from("notifications").insert(rows);
    }
    await Promise.all(pushes);
    missed = won.length;
  }

  // --- 3. REVIVE: still-sharing check-ins whose location has gone stale ---
  // If a tracked check-in's location hasn't updated in > 2 min, the device's
  // OEM power manager (Transsion/Xiaomi/etc.) likely killed the app and blocked
  // its own service from restarting. A high-priority *silent* FCM data message
  // reaches the native handler even when the app is killed and grants a short
  // window to restart the foreground service. The native side recovers the
  // check-in from prefs, so no payload beyond the action is needed.
  const staleCutoff = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const { data: staleCheckins } = await supabaseAdmin
    .from("safety_checkins")
    .select("id, user_id, location_updated_at")
    .in("status", ["active", "missed"])
    .lt("location_updated_at", staleCutoff)
    .limit(BATCH);

  for (const checkin of staleCheckins || []) {
    await sendSilentDataToUser({
      userId: checkin.user_id,
      data: { action: "revive_tracking", checkin_id: checkin.id },
      ttlMs: 2 * 60 * 1000,
      // One pending revive per user — newer collapses older.
      collapseKey: `revive-${checkin.user_id}`,
    }).catch(() => {});
    revived++;
  }

  // --- 3b. REVIVE SOS: active alerts whose location has gone stale ---
  // Same idea as check-ins. The native revive handler resurrects whichever
  // safety service has saved active state, so the action payload is identical;
  // we just also need to detect stale SOS alerts (sos_alerts.last_updated) for
  // users who have an SOS but no SML check-in.
  const { data: staleSos } = await supabaseAdmin
    .from("sos_alerts")
    .select("id, user_id, last_updated")
    .eq("status", "active")
    .lt("last_updated", staleCutoff)
    .limit(BATCH);

  for (const sos of staleSos || []) {
    await sendSilentDataToUser({
      userId: sos.user_id,
      data: { action: "revive_tracking", sos_id: sos.id },
      ttlMs: 2 * 60 * 1000,
      collapseKey: `revive-${sos.user_id}`,
    }).catch(() => {});
    revived++;
  }

  // --- 3c. Beacon SOS escalation + housekeeping ---
  // Guarded: a failure here must never affect the check-in logic above.
  let beaconEscalated = 0;
  try {
    beaconEscalated = await escalateStaleBeaconSos(supabaseAdmin);
  } catch (e) {
    console.error("[checkin-monitor] beacon escalation failed", e);
  }

  // --- 4. Clean up temp pre-upload files older than 24h ---
  const { data: tempFiles } = await supabaseAdmin.storage
    .from("media")
    .list("temp", { limit: 1000 });

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const oldTempFiles = (tempFiles || []).filter(
    (f) => f.created_at && new Date(f.created_at) < cutoff
  );

  if (oldTempFiles.length > 0) {
    await supabaseAdmin.storage
      .from("media")
      .remove(oldTempFiles.map((f) => `temp/${f.name}`));
  }

  return NextResponse.json({ ok: true, warned, missed, revived, beaconEscalated, tempCleaned: oldTempFiles.length });
}
