import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";
import { sendPushToUser } from "../_firebaseAdmin";

export const runtime = "nodejs";

const SOCIAL_PUSH_THRESHOLD = 3;
const SOCIAL_DIGEST_THRESHOLD = 10;
const SOCIAL_WINDOW_HOURS = 24;
const DM_DIGEST_THRESHOLD = 3;

type SocialKind =
  | "post_confirmed"
  | "post_comment"
  | "comment_reply"
  | "comment_liked"
  | "dm_message";

interface Body {
  kind: SocialKind;
  recipientId: string;
  actorName: string;
  postId?: string;
  conversationId?: string;
  preview?: string;
}

const SOCIAL_CONFIG: Record<
  Exclude<SocialKind, "dm_message">,
  {
    baseType: string;
    digestType: string;
    indivTitle: string;
    indivBody: (actor: string, preview?: string) => string;
    digestTitle: string;
    digestBody: (n: number) => string;
  }
> = {
  post_confirmed: {
    baseType: "post_confirmed",
    digestType: "post_confirmed_digest",
    indivTitle: "✓ Your post was confirmed",
    indivBody: (actor) => `${actor} confirmed your incident report`,
    digestTitle: "✓ Your report has been confirmed",
    digestBody: (n) => `Your incident report has ${n} confirmations`,
  },
  post_comment: {
    baseType: "post_comment",
    digestType: "post_comment_digest",
    indivTitle: "💬 New comment on your post",
    indivBody: (actor, preview) => `${actor}: ${truncate(preview || "", 50)}`,
    digestTitle: "💬 Your post has new comments",
    digestBody: (n) => `Your post has ${n} comments`,
  },
  comment_reply: {
    baseType: "comment_reply",
    digestType: "comment_reply_digest",
    indivTitle: "↩️ New reply to your comment",
    indivBody: (actor, preview) => `${actor}: ${truncate(preview || "", 60)}`,
    digestTitle: "↩️ Your comment has new replies",
    digestBody: (n) => `Your comment has ${n} replies`,
  },
  comment_liked: {
    baseType: "comment_liked",
    digestType: "comment_liked_digest",
    indivTitle: "❤️ Someone liked your comment",
    indivBody: (actor) => `${actor} liked your comment`,
    digestTitle: "❤️ Your comment has new likes",
    digestBody: (n) => `Your comment has ${n} likes`,
  },
};

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export async function POST(req: NextRequest) {
  // Diagnostic timing — breadcrumbs at each step so we can see where
  // the route spends its time. The receiver's realtime toast fires
  // when the notifications INSERT commits, so T_insert is the
  // meaningful "toast should appear" marker; everything between it
  // and T_done is post-toast work (FCM, etc).
  const t0 = Date.now();
  const lap = (label: string) =>
    console.log(`[notify-social] ${label} +${Date.now() - t0}ms`);
  try {
    const { user } = await requireUser(req);
    lap("T_auth");
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Body;
    const { kind, recipientId, actorName } = body;

    if (!kind || !recipientId || !actorName) {
      return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
    }

    // Never notify self
    if (recipientId === user.id) {
      return NextResponse.json({ ok: true, skipped: "self" });
    }

    const admin = getSupabaseAdmin();

    // Silence check (applies to social, not DMs — DMs use conversation mute)
    if (kind !== "dm_message") {
      const { data: settings } = await admin
        .from("user_settings")
        .select("social_notifications_silenced")
        .eq("user_id", recipientId)
        .maybeSingle();
      lap("T_settings");
      if (settings?.social_notifications_silenced === true) {
        return NextResponse.json({ ok: true, skipped: "silenced" });
      }
    }

    if (kind === "dm_message") {
      const res = await handleDM(admin, body, lap);
      lap("T_done");
      return res;
    }

    const res = await handleSocial(admin, body, lap);
    lap("T_done");
    return res;
  } catch (err) {
    // Surface the real failure to terminal/server logs. The outer
    // catch used to silently swallow everything and return a generic
    // 500, which made notification regressions undebuggable.
    console.error("[notify-social] route failed", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function handleSocial(
  admin: ReturnType<typeof getSupabaseAdmin>,
  body: Body,
  lap: (label: string) => void
) {
  const { kind, recipientId, actorName, postId, preview } = body;

  if (!postId) {
    return NextResponse.json({ ok: false, error: "Missing postId" }, { status: 400 });
  }

  const cfg = SOCIAL_CONFIG[kind as Exclude<SocialKind, "dm_message">];
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "Unknown kind" }, { status: 400 });
  }

  const since = new Date(Date.now() - SOCIAL_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const [{ count }, { data: digestRow }] = await Promise.all([
    admin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", recipientId)
      .eq("type", cfg.baseType)
      .filter("data->>post_id", "eq", postId)
      .gte("created_at", since),
    admin
      .from("notifications")
      .select("id, data")
      .eq("user_id", recipientId)
      .eq("type", cfg.digestType)
      .filter("data->>post_id", "eq", postId)
      .maybeSingle(),
  ]);
  lap("T_lookup");

  const individualCount = count || 0;

  if (digestRow || individualCount >= SOCIAL_DIGEST_THRESHOLD) {
    const total = ((digestRow?.data as any)?.total ?? individualCount) + 1;
    const digestBody = cfg.digestBody(total);
    // Delete-then-insert (instead of UPDATE) so the receiver's
    // postgres_changes INSERT listener actually fires. The toast
    // channel doesn't subscribe to UPDATEs, and the digest path
    // was previously swallowing every subsequent notification for
    // any recipient who already had an unread digest row.
    if (digestRow) {
      const { error: delErr } = await admin
        .from("notifications")
        .delete()
        .eq("id", digestRow.id);
      if (delErr) {
        console.error("[notify-social] social digest delete failed", delErr);
        return NextResponse.json(
          { ok: false, error: `digest delete: ${delErr.message}` },
          { status: 500 }
        );
      }
    }
    const { error: insErr } = await admin.from("notifications").insert({
      user_id: recipientId,
      type: cfg.digestType,
      title: cfg.digestTitle,
      body: digestBody,
      data: { post_id: postId, total },
      is_read: false,
    });
    if (insErr) {
      console.error("[notify-social] social digest insert failed", insErr);
      return NextResponse.json(
        { ok: false, error: `digest insert: ${insErr.message}` },
        { status: 500 }
      );
    }
    lap("T_insert");
    return NextResponse.json({ ok: true, mode: "digest", total });
  }

  // Individual notification
  const title = cfg.indivTitle;
  const indBody = cfg.indivBody(actorName, preview);

  const { error: indInsErr } = await admin.from("notifications").insert({
    user_id: recipientId,
    type: cfg.baseType,
    title,
    body: indBody,
    data: { post_id: postId },
    is_read: false,
  });
  if (indInsErr) {
    console.error("[notify-social] social insert failed", indInsErr);
    return NextResponse.json(
      { ok: false, error: `insert: ${indInsErr.message}` },
      { status: 500 }
    );
  }
  lap("T_insert");

  const shouldPush = individualCount < SOCIAL_PUSH_THRESHOLD;
  if (shouldPush) {
    await sendPushToUser({
      userId: recipientId,
      title,
      body: indBody,
      data: { post_id: postId, type: cfg.baseType },
    }).catch(() => {});
    lap("T_fcm");
  }

  return NextResponse.json({ ok: true, mode: "individual", pushed: shouldPush });
}

async function handleDM(
  admin: ReturnType<typeof getSupabaseAdmin>,
  body: Body,
  lap: (label: string) => void
) {
  const { recipientId, actorName, conversationId, preview } = body;

  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "Missing conversationId" }, { status: 400 });
  }

  // Single round-trip: mute check + digest decision + delete-old +
  // insert-new all happen inside peja_notify_dm (migration 20260610).
  // The previous implementation made four sequential REST calls,
  // each costing one network round-trip; on slow client links that
  // dominated the toast-fires latency. The function returns a row
  // describing what it actually did so we know whether to fire FCM
  // and what to report back to the caller.
  const rpcRes = await admin.rpc("peja_notify_dm", {
    p_conversation_id: conversationId,
    p_recipient_id: recipientId,
    p_actor_name: actorName,
    p_preview: preview ?? "",
    p_digest_threshold: DM_DIGEST_THRESHOLD,
  });
  lap("T_insert");

  if (rpcRes.error) {
    console.error("[notify-social] peja_notify_dm failed", rpcRes.error);
    return NextResponse.json(
      { ok: false, error: `peja_notify_dm: ${rpcRes.error.message}` },
      { status: 500 }
    );
  }

  const rows = (rpcRes.data ?? []) as Array<{
    notification_id: string | null;
    delivery_mode: "muted" | "individual" | "digest";
    total: number;
  }>;
  const result = rows[0];
  if (!result) {
    console.error("[notify-social] peja_notify_dm returned no row", rpcRes.data);
    return NextResponse.json(
      { ok: false, error: "peja_notify_dm: empty result" },
      { status: 500 }
    );
  }

  console.log("[notify-social] DM decision", {
    conversationId,
    recipientId,
    delivery_mode: result.delivery_mode,
    total: result.total,
  });

  if (result.delivery_mode === "muted") {
    return NextResponse.json({ ok: true, skipped: "muted" });
  }

  if (result.delivery_mode === "digest") {
    return NextResponse.json({ ok: true, mode: "digest", total: result.total });
  }

  // Individual mode: still fire the FCM push so the recipient gets a
  // system notification when the app isn't foregrounded. The toast on
  // the receiver's side already fired (via the realtime INSERT broadcast
  // from inside peja_notify_dm), so this only affects out-of-app
  // delivery and doesn't extend the perceived toast latency.
  const title = `📩 ${actorName}`;
  const indBody = preview ? truncate(preview, 60) : "Sent you a message";
  await sendPushToUser({
    userId: recipientId,
    title,
    body: indBody,
    data: { conversation_id: conversationId, type: "dm_message" },
  }).catch((e) => {
    console.warn("[notify-social] sendPushToUser failed (non-fatal)", e);
  });
  lap("T_fcm");

  return NextResponse.json({ ok: true, mode: "individual" });
}
