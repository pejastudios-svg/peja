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
  try {
    const { user } = await requireUser(req);
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
      if (settings?.social_notifications_silenced === true) {
        return NextResponse.json({ ok: true, skipped: "silenced" });
      }
    }

    if (kind === "dm_message") {
      return await handleDM(admin, body);
    }

    return await handleSocial(admin, body);
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}

async function handleSocial(admin: ReturnType<typeof getSupabaseAdmin>, body: Body) {
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

  const individualCount = count || 0;

  if (digestRow || individualCount >= SOCIAL_DIGEST_THRESHOLD) {
    const total = ((digestRow?.data as any)?.total ?? individualCount) + 1;
    const digestBody = cfg.digestBody(total);
    if (digestRow) {
      await admin
        .from("notifications")
        .update({
          title: cfg.digestTitle,
          body: digestBody,
          data: { post_id: postId, total },
          is_read: false,
        })
        .eq("id", digestRow.id);
    } else {
      await admin.from("notifications").insert({
        user_id: recipientId,
        type: cfg.digestType,
        title: cfg.digestTitle,
        body: digestBody,
        data: { post_id: postId, total },
        is_read: false,
      });
    }
    return NextResponse.json({ ok: true, mode: "digest", total });
  }

  // Individual notification
  const title = cfg.indivTitle;
  const indBody = cfg.indivBody(actorName, preview);

  await admin.from("notifications").insert({
    user_id: recipientId,
    type: cfg.baseType,
    title,
    body: indBody,
    data: { post_id: postId },
    is_read: false,
  });

  const shouldPush = individualCount < SOCIAL_PUSH_THRESHOLD;
  if (shouldPush) {
    await sendPushToUser({
      userId: recipientId,
      title,
      body: indBody,
      data: { post_id: postId, type: cfg.baseType },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, mode: "individual", pushed: shouldPush });
}

async function handleDM(admin: ReturnType<typeof getSupabaseAdmin>, body: Body) {
  const { recipientId, actorName, conversationId, preview } = body;

  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "Missing conversationId" }, { status: 400 });
  }

  // Respect conversation mute
  const { data: participant } = await admin
    .from("conversation_participants")
    .select("is_muted")
    .eq("conversation_id", conversationId)
    .eq("user_id", recipientId)
    .maybeSingle();
  if (participant?.is_muted) {
    return NextResponse.json({ ok: true, skipped: "muted" });
  }

  const [{ count }, { data: digestRow }] = await Promise.all([
    admin
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", recipientId)
      .eq("type", "dm_message")
      .filter("data->>conversation_id", "eq", conversationId)
      .eq("is_read", false),
    admin
      .from("notifications")
      .select("id, data")
      .eq("user_id", recipientId)
      .eq("type", "dm_message_digest")
      .filter("data->>conversation_id", "eq", conversationId)
      .eq("is_read", false)
      .maybeSingle(),
  ]);

  const unreadCount = count || 0;

  if (digestRow || unreadCount >= DM_DIGEST_THRESHOLD) {
    const total = ((digestRow?.data as any)?.total ?? unreadCount) + 1;
    const title = `📩 ${actorName}`;
    const digestBody = `You have ${total} unread messages`;

    if (digestRow) {
      await admin
        .from("notifications")
        .update({
          title,
          body: digestBody,
          data: { conversation_id: conversationId, sender_name: actorName, total },
          is_read: false,
        })
        .eq("id", digestRow.id);
    } else {
      await admin.from("notifications").insert({
        user_id: recipientId,
        type: "dm_message_digest",
        title,
        body: digestBody,
        data: { conversation_id: conversationId, sender_name: actorName, total },
        is_read: false,
      });
    }
    return NextResponse.json({ ok: true, mode: "digest", total });
  }

  const title = `📩 ${actorName}`;
  const indBody = preview ? truncate(preview, 60) : "Sent you a message";

  await admin.from("notifications").insert({
    user_id: recipientId,
    type: "dm_message",
    title,
    body: indBody,
    data: { conversation_id: conversationId, sender_name: actorName },
    is_read: false,
  });

  await sendPushToUser({
    userId: recipientId,
    title,
    body: indBody,
    data: { conversation_id: conversationId, type: "dm_message" },
  }).catch(() => {});

  return NextResponse.json({ ok: true, mode: "individual" });
}
