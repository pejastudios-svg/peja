import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const now = new Date();
  let warned = 0;
  let missed = 0;

  // --- 1. WARN: active check-ins expiring in < 5 minutes ---
  const warnCutoff = new Date(now.getTime() + 5 * 60 * 1000);

  const { data: expiringSoon } = await supabaseAdmin
    .from("safety_checkins")
    .select("id, user_id, next_check_in_at, last_confirmed_at")
    .eq("status", "active")
    .lt("next_check_in_at", warnCutoff.toISOString())
    .gt("next_check_in_at", now.toISOString());

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
    .lt("next_check_in_at", now.toISOString());

  for (const checkin of overdueCheckins || []) {
    const newMissedCount = (checkin.missed_count || 0) + 1;

    const { error: updateError } = await supabaseAdmin
      .from("safety_checkins")
      .update({
        status: "missed",
        missed_count: newMissedCount,
        updated_at: now.toISOString(),
      })
      .eq("id", checkin.id)
      .eq("status", "active");

    if (updateError) continue;

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", checkin.user_id)
      .single();

    const userName = userData?.full_name || "Your contact";

    const contactIds: string[] = checkin.contact_ids || [];

    // Fire all notifications in parallel
    await Promise.all([
      // Contacts
      contactIds.length > 0
        ? supabaseAdmin.from("notifications").insert(
            contactIds.map((contactId) => ({
              user_id: contactId,
              type: "system",
              title: "Missed Check-In",
              body: `${userName} missed their check-in. Try reaching out to them. Their location is still being shared.`,
              data: {
                type: "safety_checkin_missed",
                checkin_id: checkin.id,
                user_id: checkin.user_id,
                user_name: userName,
                missed_count: String(newMissedCount),
              },
              is_read: false,
            }))
          )
        : Promise.resolve(),
      ...contactIds.map((contactId) =>
        sendPushToUser({
          userId: contactId,
          title: "Missed Check-In",
          body: `${userName} missed their check-in. Try reaching out to them. Their location is still being shared.`,
          data: { type: "safety_checkin_missed", checkin_id: checkin.id, user_id: checkin.user_id },
        }).catch(() => {})
      ),
      // Self
      supabaseAdmin.from("notifications").insert({
        user_id: checkin.user_id,
        type: "system",
        title: "Check-In Expired",
        body: "Your safety check-in timer has expired. Your emergency contacts have been notified. Open Peja and tap 'I'm OK' to confirm you're safe.",
        data: { type: "safety_checkin_self_expired", checkin_id: checkin.id },
        is_read: false,
      }),
      sendPushToUser({
        userId: checkin.user_id,
        title: "Check-In Expired",
        body: "Your safety check-in timer has expired. Your emergency contacts have been notified. Open Peja and tap 'I'm OK' to confirm you're safe.",
        data: { type: "safety_checkin_self_expired", checkin_id: checkin.id },
      }).catch(() => {}),
    ]);

    missed++;
  }

  // --- 3. Clean up temp pre-upload files older than 24h ---
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

  return NextResponse.json({ ok: true, warned, missed, tempCleaned: oldTempFiles.length });
}
