import { getSupabaseAdmin } from "./_supabaseAdmin";
import { sendPushToUser } from "./_firebaseAdmin";
import type { BroadcastAudience, BroadcastDelivery } from "@/lib/broadcastAudience";

/**
 * Creating and delivering broadcasts.
 *
 * Lives outside the route because three callers need it: the admin screen,
 * the milestone cron, and the dispatch cron that sends scheduled ones. And
 * Next's App Router refuses extra exports from a route file.
 *
 * Deliberately split into create and deliver. A scheduled broadcast is a
 * real row the moment it is written, reviewable and cancellable, and when
 * its time comes it goes out through the SAME deliver() that pressing Send
 * uses. One delivery path, so a scheduled message cannot quietly behave
 * differently from an immediate one.
 *
 * Audience resolution happens in SQL (broadcast_recipients) so a filter is
 * evaluated once in the database rather than by pulling every user into
 * this process.
 *
 * Delivery decides how far the words travel:
 *
 *   push    - lock screen plus a notification row
 *   in_app  - notification row only, nothing on the lock screen
 *   popup   - nothing is sent; the card is shown on next app open to
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

export type BroadcastInput = {
  title: string;
  body: string;
  audience: BroadcastAudience;
  delivery: BroadcastDelivery;
  resourceText?: string | null;
  actionUrl?: string | null;
  milestoneKey?: string | null;
  endsAt?: string | null;
  /** ISO timestamp. Set means schedule it; omitted means send now. */
  scheduledFor?: string | null;
  createdBy?: string | null;
};

type Row = {
  id: string;
  title: string;
  body: string;
  resource_text: string | null;
  action_url: string | null;
  audience: BroadcastAudience;
  delivery: BroadcastDelivery;
};

/**
 * Fan a broadcast out and mark it sent. Shared by immediate sends and the
 * dispatch cron, so the two can never drift apart.
 */
async function deliver(row: Row): Promise<number> {
  const supabaseAdmin = getSupabaseAdmin();

  // Resolve the audience for every delivery type, including popups: a
  // popup sends nothing, but the size of the audience is worth recording
  // and the query is cheap.
  const { data: recipients, error: audErr } = await supabaseAdmin.rpc("broadcast_recipients", {
    p_audience: row.audience,
  });
  if (audErr) throw new Error(audErr.message);

  const ids: string[] = (recipients || []).map((r: { user_id: string }) => r.user_id);
  const body = row.resource_text ? `${row.body}\n\n${row.resource_text}` : row.body;

  // Popups are pull, not push. Each viewer is checked against the filter
  // again when they open the app, so a popup stays correct as people set
  // up codes or add contacts. The count is who matched AT SEND TIME, not a
  // delivery receipt.
  if (row.delivery !== "popup") {
    // Notification rows first, so the message is waiting in the app even
    // if the push never lands: no token, notifications denied, offline.
    for (const part of chunk(ids, CHUNK)) {
      const { error } = await supabaseAdmin.from("notifications").insert(
        part.map((userId) => ({
          user_id: userId,
          type: "broadcast",
          title: row.title,
          body,
          data: { type: "broadcast", broadcast_id: row.id, url: row.action_url || null },
          is_read: false,
        })),
      );
      if (error) console.error("[broadcasts] notification insert failed:", error.message);
    }

    if (row.delivery === "push") {
      for (const part of chunk(ids, 50)) {
        await Promise.all(
          part.map((userId) =>
            sendPushToUser({
              userId,
              title: row.title,
              body,
              data: { type: "broadcast", broadcast_id: row.id },
              collapseKey: `broadcast_${row.id}`,
            }).catch(() => 0),
          ),
        );
      }
    }
  }

  await supabaseAdmin
    .from("broadcasts")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_count: ids.length })
    .eq("id", row.id);

  return ids.length;
}

export async function sendBroadcast(
  params: BroadcastInput,
): Promise<
  | { ok: true; id: string; sentCount: number; scheduled: boolean }
  | { ok: false; error: string; status: number }
> {
  const supabaseAdmin = getSupabaseAdmin();
  const scheduled = Boolean(params.scheduledFor);

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
      scheduled_for: params.scheduledFor ?? null,
      created_by: params.createdBy ?? null,
      status: scheduled ? "scheduled" : "sent",
      sent_at: scheduled ? null : new Date().toISOString(),
    })
    .select("id, title, body, resource_text, action_url, audience, delivery")
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

  // Scheduled: the row exists and is reviewable, but nothing goes out until
  // the dispatch cron reaches it.
  if (scheduled) {
    return { ok: true, id: row.id, sentCount: 0, scheduled: true };
  }

  try {
    const sentCount = await deliver(row as Row);
    return { ok: true, id: row.id, sentCount, scheduled: false };
  } catch (e) {
    console.error("[broadcasts] delivery failed:", e);
    return { ok: false, error: "Could not work out who to send to", status: 500 };
  }
}

/**
 * Send every scheduled broadcast whose time has passed.
 *
 * Claims each row before delivering: the update is conditional on the
 * status still being 'scheduled', so two overlapping cron runs cannot send
 * the same message twice. Whichever claims it first wins and the other
 * sees zero rows.
 *
 * Due rows are picked up even if the cron was down when the moment passed,
 * because the query is "scheduled and in the past", not "scheduled for
 * right now". A late message is better than a lost one.
 */
export async function dispatchDueBroadcasts(): Promise<{
  sent: { id: string; title: string; count: number }[];
  failed: { id: string; error: string }[];
}> {
  const supabaseAdmin = getSupabaseAdmin();
  const sent: { id: string; title: string; count: number }[] = [];
  const failed: { id: string; error: string }[] = [];

  const { data: due } = await supabaseAdmin
    .from("broadcasts")
    .select("id, title, body, resource_text, action_url, audience, delivery")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(20);

  for (const row of due || []) {
    // Claim it first. deliver() sets the final state, but this stops a
    // second overlapping run from picking up the same row mid-flight.
    const { data: claimed } = await supabaseAdmin
      .from("broadcasts")
      .update({ status: "sent" })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    try {
      const count = await deliver(row as Row);
      sent.push({ id: row.id, title: row.title, count });
    } catch (e) {
      failed.push({ id: row.id, error: (e as Error).message });
      console.error("[broadcasts] scheduled delivery failed:", row.id, e);
    }
  }

  return { sent, failed };
}
