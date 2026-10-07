import { getSupabaseAdmin } from "./_supabaseAdmin";
import { sendPushToUser } from "./_firebaseAdmin";
import type { BroadcastAudience, BroadcastDelivery } from "@/lib/broadcastAudience";

/**
 * Create a broadcast row and deliver it.
 *
 * Lives outside the route because both the admin screen and the milestone
 * cron send broadcasts, and Next's App Router refuses extra exports from a
 * route file.
 *
 * Audience resolution happens in SQL (broadcast_recipients) so a filter is
 * evaluated once in the database rather than by pulling every user into
 * this process.
 *
 * Delivery decides how far the words travel:
 *
 *   push    - lock screen plus a notification row
 *   in_app  - notification row only, nothing on the lock screen
 *   popup   - nothing is sent now; the card is shown on next app open to
 *             whoever still matches the filter at that moment
 *
 * The push/in_app split is a safety decision, not a preference. A push
 * body is readable by anyone standing near the phone, which for messages
 * about violence or self-harm can expose the very person it means to help.
 */

const CHUNK = 500;

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function sendBroadcast(params: {
  title: string;
  body: string;
  audience: BroadcastAudience;
  delivery: BroadcastDelivery;
  resourceText?: string | null;
  actionUrl?: string | null;
  milestoneKey?: string | null;
  endsAt?: string | null;
  createdBy?: string | null;
}): Promise<{ ok: true; id: string; sentCount: number } | { ok: false; error: string; status: number }> {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: row, error: insErr } = await supabaseAdmin
    .from("broadcasts")
    .insert({
      title: params.title,
      body: params.body,
      resource_text: params.resourceText ?? null,
      action_url: params.actionUrl ?? null,
      audience: params.audience,
      delivery: params.delivery,
      milestone_key: params.milestoneKey ?? null,
      ends_at: params.endsAt ?? null,
      created_by: params.createdBy ?? null,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr || !row) {
    // A unique violation on milestone_key means the cron already sent this
    // one. That is the guard working, not a failure.
    if (insErr?.code === "23505") {
      return { ok: false, error: "Already sent", status: 409 };
    }
    console.error("[broadcasts] insert failed:", insErr?.message);
    return { ok: false, error: "Could not create the broadcast", status: 500 };
  }

  // Resolve the audience for every delivery type, including popups.
  //
  // Popups used to return here before counting anyone, which is why the
  // admin list reported 0 for a popup that plenty of people could see. A
  // popup still sends nothing now, but the size of the audience is worth
  // knowing and the query is cheap.
  const { data: recipients, error: audErr } = await supabaseAdmin.rpc("broadcast_recipients", {
    p_audience: params.audience,
  });
  if (audErr) {
    console.error("[broadcasts] audience failed:", audErr.message);
    return { ok: false, error: "Could not work out who to send to", status: 500 };
  }

  const ids: string[] = (recipients || []).map((r: { user_id: string }) => r.user_id);

  // Popups are pull, not push: nothing goes out now. Each viewer is checked
  // against the filter again when they open the app, so a popup stays
  // correct as people set up codes or add contacts. The count recorded here
  // is therefore who matched AT SEND TIME, not a delivery receipt.
  if (params.delivery === "popup") {
    await supabaseAdmin.from("broadcasts").update({ sent_count: ids.length }).eq("id", row.id);
    return { ok: true, id: row.id, sentCount: ids.length };
  }

  // Notification rows first, so the message is waiting in the app even if
  // the push never lands (no token, notifications denied, device offline).
  const body = params.resourceText ? `${params.body}\n\n${params.resourceText}` : params.body;
  for (const part of chunk(ids, CHUNK)) {
    const { error } = await supabaseAdmin.from("notifications").insert(
      part.map((userId) => ({
        user_id: userId,
        type: "broadcast",
        title: params.title,
        body,
        data: { type: "broadcast", broadcast_id: row.id, url: params.actionUrl || null },
        is_read: false,
      })),
    );
    if (error) console.error("[broadcasts] notification insert failed:", error.message);
  }

  let sent = 0;
  if (params.delivery === "push") {
    for (const part of chunk(ids, 50)) {
      const results = await Promise.all(
        part.map((userId) =>
          sendPushToUser({
            userId,
            title: params.title,
            body,
            data: { type: "broadcast", broadcast_id: row.id },
            collapseKey: `broadcast_${row.id}`,
          }).catch(() => 0),
        ),
      );
      sent += results.reduce((a, b) => a + b, 0);
    }
  }

  await supabaseAdmin
    .from("broadcasts")
    .update({ sent_count: ids.length })
    .eq("id", row.id);

  return { ok: true, id: row.id, sentCount: ids.length };
}

