// Supabase data layer for the v2 chat. Pure functions that read or write
// the DB and return shaped data. They never touch the store directly —
// callers (provider, page hooks) decide what to do with the result.

import { supabase } from "@/lib/supabase";
import type {
  ChatConversationSummary,
  ChatMessage,
  ChatMessageMedia,
  DeliveryStatus,
  MessageReaction,
  ReplyTarget,
} from "./types";

// =====================================================
// Conversation list
// =====================================================

interface ConversationRow {
  id: string;
  last_message_text: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  updated_at: string | null;
  is_group?: boolean | null;
  group_name?: string | null;
  group_avatar_url?: string | null;
  created_by?: string | null;
}

interface ParticipantRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  is_muted?: boolean | null;
  is_blocked?: boolean | null;
  hidden_at?: string | null;
  role?: "owner" | "member" | null;
  is_pinned?: boolean | null;
  pinned_at?: string | null;
  notification_mode?: "all" | "mentions" | "muted" | null;
}

interface UserRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  last_seen_at: string | null;
}

/**
 * Loads the user's full conversation list with everything the UI needs:
 * other user info, last preview, unread count, and seen status.
 *
 * Today this is four sequential round-trips (participants → conversations
 * → other participants → other users + unread counts). When the chat gets
 * meaningful traffic we'll move this behind a Postgres view / RPC for a
 * single round-trip. Phase 1 keeps the simpler approach so the wire
 * format is obvious.
 */
export async function fetchConversationList(
  currentUserId: string
): Promise<ChatConversationSummary[]> {
  // 1. My participations (so we know which conversations are mine, and my
  //    last_read_at for unread counting, plus is_muted / is_blocked /
  //    hidden_at for the chat-info sheet and the conversation list
  //    filter). `role` joined here gates the group owner controls in
  //    the chat-info sheet.
  const { data: myParts, error: e1 } = await supabase
    .from("conversation_participants")
    .select(
      "conversation_id, last_read_at, is_muted, is_blocked, hidden_at, role, is_pinned, pinned_at, notification_mode"
    )
    .eq("user_id", currentUserId);
  if (e1) throw e1;
  if (!myParts || myParts.length === 0) return [];

  const conversationIds = myParts.map((p) => p.conversation_id);
  const myReadByConv: Record<string, string | null> = {};
  const myMuteByConv: Record<string, boolean> = {};
  const myBlockedByConv: Record<string, boolean> = {};
  const myHiddenByConv: Record<string, string | null> = {};
  const myRoleByConv: Record<string, "owner" | "member"> = {};
  const myPinByConv: Record<string, { is_pinned: boolean; pinned_at: string | null }> = {};
  const myNotifyByConv: Record<string, "all" | "mentions" | "muted"> = {};
  for (const p of myParts) {
    myReadByConv[p.conversation_id] = p.last_read_at;
    myMuteByConv[p.conversation_id] = !!(p as ParticipantRow).is_muted;
    myBlockedByConv[p.conversation_id] = !!(p as ParticipantRow).is_blocked;
    myHiddenByConv[p.conversation_id] = (p as ParticipantRow).hidden_at ?? null;
    const r = (p as ParticipantRow).role;
    if (r === "owner" || r === "member") myRoleByConv[p.conversation_id] = r;
    myPinByConv[p.conversation_id] = {
      is_pinned: !!(p as ParticipantRow).is_pinned,
      pinned_at: (p as ParticipantRow).pinned_at ?? null,
    };
    const mode = (p as ParticipantRow).notification_mode;
    if (mode === "all" || mode === "mentions" || mode === "muted") {
      myNotifyByConv[p.conversation_id] = mode;
    }
  }

  // 2. Conversations + other participants + their users — in parallel.
  //    We also pull the other participant's `is_blocked` flag so the
  //    blocked-by-them banner can show up on initial load (not just
  //    after a realtime UPDATE). The participants query intentionally
  //    pulls ALL participants (not just `<> currentUserId`) so we can
  //    compute group member counts without a second query.
  const [convRes, allPartRes] = await Promise.all([
    supabase.from("conversations").select("*").in("id", conversationIds),
    supabase
      .from("conversation_participants")
      .select("conversation_id, user_id, last_read_at, is_blocked, role")
      .in("conversation_id", conversationIds),
  ]);
  if (convRes.error) throw convRes.error;
  if (allPartRes.error) throw allPartRes.error;

  const convs = (convRes.data || []) as ConversationRow[];
  const allParts = (allPartRes.data || []) as ParticipantRow[];

  // Per-conversation rollups. For DMs `otherByConv` still holds the
  // single non-me participant (driving the existing other_user_*
  // fields); for groups we additionally track total member count.
  const otherByConv: Record<string, ParticipantRow> = {};
  const memberCountByConv: Record<string, number> = {};
  for (const p of allParts) {
    memberCountByConv[p.conversation_id] =
      (memberCountByConv[p.conversation_id] || 0) + 1;
    if (p.user_id !== currentUserId) {
      otherByConv[p.conversation_id] = p;
    }
  }

  const otherUserIds = [
    ...new Set(
      allParts
        .filter((p) => p.user_id !== currentUserId)
        .map((p) => p.user_id)
        .filter(Boolean)
    ),
  ];
  let usersById: Record<string, UserRow> = {};
  if (otherUserIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, full_name, avatar_url, last_seen_at")
      .in("id", otherUserIds);
    for (const u of (users || []) as UserRow[]) usersById[u.id] = u;
  }

  // 3. Unread counts in parallel — count rows in `messages` after my
  //    last_read_at, sent by someone else.
  const unreadByConv: Record<string, number> = {};
  await Promise.all(
    conversationIds.map(async (cid) => {
      const lastRead = myReadByConv[cid];
      if (!lastRead) {
        unreadByConv[cid] = 0;
        return;
      }
      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", cid)
        .neq("sender_id", currentUserId)
        .gt("created_at", lastRead)
        .eq("is_deleted", false);
      unreadByConv[cid] = count || 0;
    })
  );

  // 4. Assemble + filter rows the current user has "deleted" (hidden_at
  //    set, and no newer message has arrived since). A newer message
  //    un-hides the conversation in handleMessageInsert; doing the same
  //    check here covers the case where the user re-opens the app after
  //    the other side sent something while we were offline.
  const result: ChatConversationSummary[] = [];
  for (const conv of convs) {
    const isGroup = !!conv.is_group;
    const other = otherByConv[conv.id];
    // DMs skip if the other side is missing (orphaned row). Groups
    // are allowed through even when peja is the only member.
    if (!isGroup && !other) continue;

    const hiddenAt = myHiddenByConv[conv.id];
    if (
      hiddenAt &&
      (!conv.last_message_at ||
        new Date(conv.last_message_at) <= new Date(hiddenAt))
    ) {
      continue;
    }

    const otherUser = other ? usersById[other.user_id] : undefined;

    // Seen indicator is meaningless for groups (would need an N-way
    // last-read aggregate). Leave it false there for now.
    let last_message_seen = false;
    if (
      !isGroup &&
      other &&
      conv.last_message_sender_id === currentUserId &&
      conv.last_message_at &&
      other.last_read_at &&
      new Date(other.last_read_at) >= new Date(conv.last_message_at)
    ) {
      last_message_seen = true;
    }

    // For groups we surface the group name + avatar through the same
    // other_user_name / other_user_avatar_url fields so existing list /
    // header renders work without branching everywhere. is_group +
    // group_* are still authoritative for any caller that needs them.
    const displayName = isGroup
      ? conv.group_name || "Group"
      : otherUser?.full_name ?? null;
    const displayAvatar = isGroup
      ? conv.group_avatar_url ?? null
      : otherUser?.avatar_url ?? null;

    result.push({
      id: conv.id,
      other_user_id: other?.user_id ?? "",
      other_user_name: displayName,
      other_user_avatar_url: displayAvatar,
      other_user_last_seen_at: otherUser?.last_seen_at ?? null,
      last_message_text: conv.last_message_text,
      last_message_at: conv.last_message_at,
      last_message_sender_id: conv.last_message_sender_id,
      last_message_seen,
      unread_count: unreadByConv[conv.id] || 0,
      is_muted: myMuteByConv[conv.id] || false,
      is_blocked: myBlockedByConv[conv.id] || false,
      blocked_by_other: !isGroup && !!(other as ParticipantRow)?.is_blocked,
      my_last_read_at: myReadByConv[conv.id] ?? null,
      is_group: isGroup,
      group_name: conv.group_name ?? null,
      group_avatar_url: conv.group_avatar_url ?? null,
      member_count: isGroup ? memberCountByConv[conv.id] || 0 : undefined,
      my_role: myRoleByConv[conv.id],
      is_pinned: myPinByConv[conv.id]?.is_pinned ?? false,
      pinned_at: myPinByConv[conv.id]?.pinned_at ?? null,
      notification_mode: myNotifyByConv[conv.id] ?? "all",
    });
  }
  return result;
}

// =====================================================
// Thread (messages in a single conversation)
// =====================================================

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  content_type: ChatMessage["content_type"];
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  reply_to_id: string | null;
  is_pinned?: boolean | null;
  pinned_at?: string | null;
}

/**
 * Loads the most recent N messages for a conversation, plus the other
 * participant's last_read_at so we can compute delivery_status for each
 * of the current user's messages. Also hydrates `message_media` for any
 * message whose content_type is not "text" — so image / video bubbles
 * have their URLs ready on first render.
 *
 * Returns messages chronologically (oldest first), which is the order
 * the thread UI renders.
 */
export async function fetchThread(
  conversationId: string,
  currentUserId: string,
  limit = 50,
  // Pagination cursor. When set, fetch only messages older than this
  // ISO timestamp — used by the chat page's "load older on scroll
  // up" pagination. Omit (or pass undefined) for the initial page.
  before?: string
): Promise<ChatMessage[]> {
  // Fetch messages + other user's last_read_at + my message_deletions
  // in parallel. message_deletions is a per-user "delete for me" /
  // "clear chat" record — we filter those rows out of the thread so
  // cleared messages stay cleared across reloads.
  let messagesQuery = supabase
    .from("messages")
    .select(
      "id, conversation_id, sender_id, content, content_type, created_at, edited_at, is_deleted, reply_to_id, is_pinned, pinned_at"
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) {
    messagesQuery = messagesQuery.lt("created_at", before);
  }
  const [msgsRes, partsRes, deletionsRes] = await Promise.all([
    messagesQuery,
    supabase
      .from("conversation_participants")
      .select("user_id, last_read_at")
      .eq("conversation_id", conversationId)
      .neq("user_id", currentUserId),
    supabase
      .from("message_deletions")
      .select("message_id")
      .eq("user_id", currentUserId),
  ]);
  if (msgsRes.error) throw msgsRes.error;
  if (partsRes.error) throw partsRes.error;

  const myDeletedIds = new Set(
    (deletionsRes.data || []).map(
      (d: { message_id: string }) => d.message_id
    )
  );
  const rows = ((msgsRes.data || []) as MessageRow[])
    .reverse() // chronological
    .filter((r) => !myDeletedIds.has(r.id));
  const otherLastRead = partsRes.data?.[0]?.last_read_at || null;

  // Fetch media in one round-trip for any non-text rows AND fetch the
  // parent messages for any reply rows — both in parallel, both
  // fanned-in by id.
  const mediaCarriers = rows.filter((r) => r.content_type !== "text").map((r) => r.id);
  const replyParentIds = Array.from(
    new Set(rows.map((r) => r.reply_to_id).filter((v): v is string => !!v))
  );
  const allMessageIds = rows.map((r) => r.id);
  const [mediaByMessage, replyTargetsById, reactionsByMessage] = await Promise.all([
    mediaCarriers.length
      ? fetchMediaForMessages(mediaCarriers)
      : Promise.resolve({} as Record<string, ChatMessageMedia[]>),
    replyParentIds.length
      ? fetchReplyTargets(replyParentIds)
      : Promise.resolve({} as Record<string, ReplyTarget>),
    allMessageIds.length
      ? fetchReactionsForMessages(allMessageIds)
      : Promise.resolve({} as Record<string, MessageReaction[]>),
  ]);

  return rows.map((row) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content,
    content_type: row.content_type,
    created_at: row.created_at,
    edited_at: row.edited_at,
    is_deleted: row.is_deleted,
    reply_to_id: row.reply_to_id,
    reply_to: row.reply_to_id ? replyTargetsById[row.reply_to_id] ?? null : null,
    delivery_status: computeDeliveryStatus(row, currentUserId, otherLastRead),
    media: mediaByMessage[row.id],
    reactions: reactionsByMessage[row.id],
    is_pinned: !!row.is_pinned,
    pinned_at: row.pinned_at ?? null,
  }));
}

/**
 * Bulk-fetch every reaction row attached to a set of messages,
 * grouped by message id. Used by fetchThread + by the realtime layer
 * when reconciling a re-sync.
 */
export async function fetchReactionsForMessages(
  messageIds: string[]
): Promise<Record<string, MessageReaction[]>> {
  if (messageIds.length === 0) return {};
  const { data, error } = await supabase
    .from("message_reactions")
    .select("id, message_id, user_id, emoji, created_at")
    .in("message_id", messageIds);
  if (error) throw error;
  const grouped: Record<string, MessageReaction[]> = {};
  for (const r of (data || []) as MessageReaction[]) {
    if (!grouped[r.message_id]) grouped[r.message_id] = [];
    grouped[r.message_id].push(r);
  }
  return grouped;
}

/**
 * Hydrate parent-message snapshots for a batch of reply_to_ids. We
 * pull only the fields the quoted-reference block needs plus a single
 * row of message_media so we can show "📷 Photo" / "🎙 Voice note"
 * when the parent was media-only.
 *
 * Exported (vs inlined into fetchThread) because the realtime layer
 * also needs to resolve the parent of a single incoming reply.
 */
export async function fetchReplyTargets(
  messageIds: string[]
): Promise<Record<string, ReplyTarget>> {
  if (messageIds.length === 0) return {};
  const [msgsRes, mediaRes] = await Promise.all([
    supabase
      .from("messages")
      .select("id, sender_id, content, content_type, is_deleted")
      .in("id", messageIds),
    supabase
      .from("message_media")
      .select("message_id, media_type")
      .in("message_id", messageIds),
  ]);
  const kindByMessage: Record<string, ReplyTarget["preview_kind"]> = {};
  for (const r of (mediaRes.data || []) as Array<{
    message_id: string;
    media_type: ReplyTarget["preview_kind"];
  }>) {
    // First media row wins as the preview kind. A bundle of images
    // surfaces as "image"; a doc-only message as "document"; etc.
    if (!kindByMessage[r.message_id]) {
      kindByMessage[r.message_id] = r.media_type;
    }
  }
  const out: Record<string, ReplyTarget> = {};
  for (const m of (msgsRes.data || []) as Array<{
    id: string;
    sender_id: string;
    content: string | null;
    content_type: string;
    is_deleted: boolean;
  }>) {
    out[m.id] = {
      id: m.id,
      sender_id: m.sender_id,
      content: m.content,
      is_deleted: m.is_deleted,
      preview_kind: kindByMessage[m.id] ?? "text",
    };
  }
  return out;
}

export interface CrossChatSearchResult {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  // Other-user side of the conversation this match lives in — used
  // by the cross-chat search UI to label results with whose chat
  // they came from. Pulled from conversation_participants + users
  // in a single follow-up round-trip.
  other_user_id: string | null;
  other_user_name: string | null;
  other_user_avatar_url: string | null;
}

/**
 * Cross-chat message search. Walks every conversation the current
 * user participates in and finds messages whose content matches the
 * query string (case-insensitive). Filters out the user's own
 * cleared messages + tombstones. Results are newest-first.
 *
 * Returns the conversation's "other user" alongside each match so
 * the search UI can render rows like `<avatar> Alice — "…match…"`
 * without doing N follow-up lookups.
 */
export async function searchMessagesGlobally(
  currentUserId: string,
  query: string,
  limit = 50
): Promise<CrossChatSearchResult[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];

  // Step 1: which conversations are mine? Used to scope the message
  // search AND to drive the other-user lookup later.
  const { data: parts, error: pErr } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", currentUserId);
  if (pErr) throw pErr;
  const convIds = (parts || []).map(
    (p: { conversation_id: string }) => p.conversation_id
  );
  if (convIds.length === 0) return [];

  // Step 2: matching messages + my message_deletions in parallel.
  const escaped = cleaned.replace(/[\\%_]/g, (m) => `\\${m}`);
  const [msgsRes, deletionsRes] = await Promise.all([
    supabase
      .from("messages")
      .select("id, conversation_id, sender_id, content, created_at")
      .in("conversation_id", convIds)
      .eq("is_deleted", false)
      .ilike("content", `%${escaped}%`)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("message_deletions")
      .select("message_id")
      .eq("user_id", currentUserId),
  ]);
  if (msgsRes.error) throw msgsRes.error;
  const myDeleted = new Set(
    (deletionsRes.data || []).map(
      (d: { message_id: string }) => d.message_id
    )
  );
  const matched = ((msgsRes.data || []) as Array<{
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string | null;
    created_at: string;
  }>).filter((m) => !myDeleted.has(m.id));
  if (matched.length === 0) return [];

  // Step 3: resolve the OTHER participant + their user row for each
  // distinct conversation in the results. One round-trip each;
  // batched by `in()`.
  const matchedConvIds = Array.from(new Set(matched.map((m) => m.conversation_id)));
  const { data: others, error: othersErr } = await supabase
    .from("conversation_participants")
    .select("conversation_id, user_id")
    .in("conversation_id", matchedConvIds)
    .neq("user_id", currentUserId);
  if (othersErr) throw othersErr;
  const otherUserIdByConv: Record<string, string> = {};
  for (const o of (others || []) as Array<{
    conversation_id: string;
    user_id: string;
  }>) {
    otherUserIdByConv[o.conversation_id] = o.user_id;
  }
  const userIds = Array.from(new Set(Object.values(otherUserIdByConv)));
  const usersById: Record<
    string,
    { id: string; full_name: string | null; avatar_url: string | null }
  > = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, full_name, avatar_url")
      .in("id", userIds);
    for (const u of (users || []) as Array<{
      id: string;
      full_name: string | null;
      avatar_url: string | null;
    }>) {
      usersById[u.id] = u;
    }
  }

  return matched.map((m) => {
    const otherId = otherUserIdByConv[m.conversation_id] ?? null;
    const other = otherId ? usersById[otherId] : null;
    return {
      id: m.id,
      conversation_id: m.conversation_id,
      sender_id: m.sender_id,
      content: m.content,
      created_at: m.created_at,
      other_user_id: otherId,
      other_user_name: other?.full_name ?? null,
      other_user_avatar_url: other?.avatar_url ?? null,
    };
  });
}

/**
 * Search within a single conversation. Returns matching messages
 * (text content only — media filenames aren't indexed yet) newest
 * first, with media + reply targets hydrated so result rows render
 * with the right preview.
 *
 * Filters out:
 *   • messages the current user has cleared (message_deletions)
 *   • is_deleted=true rows (no point matching tombstones)
 *
 * `ilike` with `%query%` is fine at this scale; if the per-chat
 * volume balloons we'd swap to a tsvector index. The trim + escape
 * keeps a stray `%` or `_` from acting as a wildcard.
 */
export async function searchMessagesInConversation(
  conversationId: string,
  currentUserId: string,
  query: string,
  limit = 50
): Promise<ChatMessage[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];
  const escaped = cleaned.replace(/[\\%_]/g, (m) => `\\${m}`);
  const [msgsRes, deletionsRes] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "id, conversation_id, sender_id, content, content_type, created_at, edited_at, is_deleted, reply_to_id"
      )
      .eq("conversation_id", conversationId)
      .eq("is_deleted", false)
      .ilike("content", `%${escaped}%`)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("message_deletions")
      .select("message_id")
      .eq("user_id", currentUserId),
  ]);
  if (msgsRes.error) throw msgsRes.error;
  const myDeleted = new Set(
    (deletionsRes.data || []).map(
      (d: { message_id: string }) => d.message_id
    )
  );
  const rows = ((msgsRes.data || []) as MessageRow[]).filter(
    (r) => !myDeleted.has(r.id)
  );

  // Hydrate media + reply parents so each result renders with its
  // preview. Reactions are skipped — they're not relevant to search
  // result rendering and save us a round-trip.
  const mediaCarriers = rows.filter((r) => r.content_type !== "text").map((r) => r.id);
  const replyParentIds = Array.from(
    new Set(rows.map((r) => r.reply_to_id).filter((v): v is string => !!v))
  );
  const [mediaByMessage, replyTargetsById] = await Promise.all([
    mediaCarriers.length
      ? fetchMediaForMessages(mediaCarriers)
      : Promise.resolve({} as Record<string, ChatMessageMedia[]>),
    replyParentIds.length
      ? fetchReplyTargets(replyParentIds)
      : Promise.resolve({} as Record<string, ReplyTarget>),
  ]);

  return rows.map((row) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content,
    content_type: row.content_type,
    created_at: row.created_at,
    edited_at: row.edited_at,
    is_deleted: row.is_deleted,
    reply_to_id: row.reply_to_id,
    reply_to: row.reply_to_id ? replyTargetsById[row.reply_to_id] ?? null : null,
    delivery_status: row.sender_id === currentUserId ? "sent" : "sent",
    media: mediaByMessage[row.id],
  }));
}

/**
 * Bulk-fetch media rows grouped by message id. Used by fetchThread for the
 * initial hydrate and by the realtime layer when a single new media row
 * arrives.
 */
export async function fetchMediaForMessages(
  messageIds: string[]
): Promise<Record<string, ChatMessageMedia[]>> {
  if (messageIds.length === 0) return {};
  const { data, error } = await supabase
    .from("message_media")
    .select(
      "id, message_id, url, media_type, file_name, file_size, mime_type, thumbnail_url, created_at"
    )
    .in("message_id", messageIds);
  if (error) throw error;
  const grouped: Record<string, ChatMessageMedia[]> = {};
  for (const row of (data || []) as ChatMessageMedia[]) {
    if (!grouped[row.message_id]) grouped[row.message_id] = [];
    grouped[row.message_id].push(row);
  }
  return grouped;
}

function computeDeliveryStatus(
  row: MessageRow,
  currentUserId: string,
  otherLastRead: string | null
): DeliveryStatus {
  // Recipient-side messages have no sender-side status — render as "sent"
  // so the field is always defined. UI only displays the badge for the
  // current user's own messages.
  if (row.sender_id !== currentUserId) return "sent";
  if (!otherLastRead) return "sent";
  return new Date(otherLastRead) >= new Date(row.created_at) ? "seen" : "sent";
}

// =====================================================
// Send
// =====================================================

interface SendMessageInput {
  id: string; // Client-generated UUIDv4 — used as the row's primary key.
  conversation_id: string;
  sender_id: string;
  content: string;
  reply_to_id?: string | null;
}

/**
 * Inserts a text message. Returns the server-confirmed row on success.
 *
 * The conversation summary update is handled server-side by the
 * peja_messages_sync_conversation_ins trigger — clients no longer need to
 * patch conversations.last_message_* themselves.
 */
export async function sendTextMessage(input: SendMessageInput): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      id: input.id,
      conversation_id: input.conversation_id,
      sender_id: input.sender_id,
      content: input.content,
      content_type: "text",
      reply_to_id: input.reply_to_id ?? null,
      metadata: {},
    })
    .select("id, conversation_id, sender_id, content, content_type, created_at, edited_at, is_deleted, reply_to_id")
    .single();
  if (error) throw error;
  const row = data as MessageRow;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content,
    content_type: row.content_type,
    created_at: row.created_at,
    edited_at: row.edited_at,
    is_deleted: row.is_deleted,
    reply_to_id: row.reply_to_id,
    delivery_status: "sent",
  };
}

// =====================================================
// Media uploads
// =====================================================
//
// Two-step server write for a media message:
//   1. Upload the file to the `message-media` storage bucket → public URL
//   2. Insert the `messages` row + `message_media` row(s) atomically
//      (we wrap in a tiny try/cleanup so a failed media insert deletes
//      the orphaned messages row).
//
// Storage bucket and path layout match v1 so existing public URLs and
// access policies keep working: `messages/{conversation_id}/{ts}_{name}`.

const MEDIA_BUCKET = "message-media";

export async function uploadMediaToStorage(args: {
  conversationId: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const safeName = args.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  const path = `messages/${args.conversationId}/${Date.now()}_${safeName}`;
  const { error: uploadErr } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, args.blob, {
      contentType: args.mimeType || "application/octet-stream",
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadErr) throw uploadErr;
  const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  if (!urlData?.publicUrl) {
    throw new Error("storage public URL missing after upload");
  }
  return urlData.publicUrl;
}

interface SendMediaMessageInput {
  id: string;
  conversation_id: string;
  sender_id: string;
  caption?: string | null;
  reply_to_id?: string | null;
  // Already-uploaded attachments: url + metadata. We pre-generate each
  // attachment's `id` client-side (matches the optimistic ids in the
  // store) and pass it in here, so we don't depend on the INSERT's
  // RETURNING / `.select()` to know what was just written. Some RLS
  // configurations allow INSERT but not SELECT against a row right
  // after writing it — that was emptying out `confirmed.media` and
  // wiping the bubble after a successful upload.
  attachments: Array<{
    id: string;
    url: string;
    media_type: "image" | "video" | "audio" | "document";
    file_name: string;
    file_size: number;
    mime_type: string;
    thumbnail_url?: string | null;
  }>;
}

/**
 * Insert a media message + its message_media rows. If the media insert
 * fails, the orphaned messages row is deleted so we don't leave a row
 * with content_type=media and no media attached.
 *
 * Returns a fully-populated `media` array built from the input — we
 * deliberately do NOT trust the INSERT's `.select()` because RLS may
 * block the implicit RETURNING even when the write itself succeeds.
 */
export async function sendMediaMessage(
  input: SendMediaMessageInput
): Promise<ChatMessage> {
  const caption = input.caption?.trim() || null;
  const { data: msgRow, error: msgErr } = await supabase
    .from("messages")
    .insert({
      id: input.id,
      conversation_id: input.conversation_id,
      sender_id: input.sender_id,
      content: caption,
      content_type: "media",
      reply_to_id: input.reply_to_id ?? null,
      metadata: {},
    })
    .select(
      "id, conversation_id, sender_id, content, content_type, created_at, edited_at, is_deleted, reply_to_id"
    )
    .single();
  if (msgErr) throw msgErr;

  const nowIso = new Date().toISOString();
  const mediaRows = input.attachments.map((a) => ({
    id: a.id,
    message_id: input.id,
    url: a.url,
    media_type: a.media_type,
    file_name: a.file_name,
    file_size: a.file_size,
    mime_type: a.mime_type,
    thumbnail_url: a.thumbnail_url ?? null,
  }));
  const { error: mediaErr } = await supabase
    .from("message_media")
    .insert(mediaRows);
  if (mediaErr) {
    // Roll back the message row so we don't leave an empty media bubble.
    await supabase.from("messages").delete().eq("id", input.id);
    throw mediaErr;
  }

  // Build media array from input (the canonical values we just wrote).
  // The realtime INSERT handler will later re-fetch from the DB for the
  // other participant; that path uses the same `message_media` row, so
  // both sides converge on the same data with the same ids.
  const media: ChatMessageMedia[] = input.attachments.map((a) => ({
    id: a.id,
    message_id: input.id,
    url: a.url,
    media_type: a.media_type,
    file_name: a.file_name,
    file_size: a.file_size,
    mime_type: a.mime_type,
    thumbnail_url: a.thumbnail_url ?? null,
    created_at: nowIso,
  }));
  console.log("[chat-v2] sendMediaMessage built media", {
    id: input.id,
    count: media.length,
    first_url: media[0]?.url,
  });

  const row = msgRow as MessageRow;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content,
    content_type: row.content_type,
    created_at: row.created_at,
    edited_at: row.edited_at,
    is_deleted: row.is_deleted,
    reply_to_id: row.reply_to_id,
    delivery_status: "sent",
    media,
  };
}

// =====================================================
// Read receipts
// =====================================================

/**
 * Marks all messages in a conversation as read by `currentUserId`,
 * up to and including any unread messages from the other participant.
 * Used when the user opens a conversation.
 *
 * Returns the timestamp written so the caller can also patch the
 * local store's `my_last_read_at` — without that the in-memory copy
 * stays stale and downstream features (e.g. the "Unread messages"
 * divider) keep treating already-read messages as unread on every
 * subsequent open.
 */
export async function markConversationRead(
  conversationId: string,
  currentUserId: string
): Promise<string> {
  // last_read_at = max(latest message timestamp, now). Setting it 1s past
  // the latest message timestamp matches v1's behavior and ensures the
  // strictly-greater-than filter in unread counts excludes our own catch-up.
  const { data: latest } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1);
  const readAt = latest && latest.length > 0
    ? new Date(new Date(latest[0].created_at).getTime() + 1000).toISOString()
    : new Date().toISOString();
  await supabase
    .from("conversation_participants")
    .update({ last_read_at: readAt })
    .eq("conversation_id", conversationId)
    .eq("user_id", currentUserId);
  return readAt;
}

// =====================================================
// Chat info — shared media + actions
// =====================================================

export interface SharedMediaBuckets {
  images: ChatMessageMedia[];
  videos: ChatMessageMedia[];
  audios: ChatMessageMedia[];
  documents: ChatMessageMedia[];
}

export interface SharedLink {
  url: string;
  message_id: string;
  created_at: string;
  context: string;
}

/**
 * Fetch every message_media row for the conversation, grouped by type.
 * Filters out media for messages the current user has cleared.
 *
 * Joins through messages so we can scope by conversation_id (message_media
 * itself only has message_id), and filters out media for messages the
 * current user has cleared (so the chat-info gallery doesn't keep showing
 * media you've already deleted for yourself).
 */
export async function fetchSharedMedia(
  conversationId: string,
  currentUserId: string
): Promise<SharedMediaBuckets> {
  const [messagesRes, deletionsRes] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "id, message_media(id, message_id, url, media_type, file_name, file_size, mime_type, thumbnail_url, created_at)"
      )
      .eq("conversation_id", conversationId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("message_deletions")
      .select("message_id")
      .eq("user_id", currentUserId),
  ]);
  if (messagesRes.error) throw messagesRes.error;

  const myDeleted = new Set(
    (deletionsRes.data || []).map(
      (d: { message_id: string }) => d.message_id
    )
  );

  const buckets: SharedMediaBuckets = {
    images: [],
    videos: [],
    audios: [],
    documents: [],
  };

  type Row = { id: string; message_media: ChatMessageMedia[] | null };
  for (const row of (messagesRes.data || []) as Row[]) {
    if (myDeleted.has(row.id)) continue;
    for (const m of row.message_media || []) {
      if (m.media_type === "image") buckets.images.push(m);
      else if (m.media_type === "video") buckets.videos.push(m);
      else if (m.media_type === "audio") buckets.audios.push(m);
      else if (m.media_type === "document") buckets.documents.push(m);
    }
  }
  return buckets;
}

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;

/**
 * Walks text messages in the conversation, regex-extracts every URL,
 * returns them newest-first. Filters out cleared messages the same way
 * fetchSharedMedia does.
 */
export async function fetchSharedLinks(
  conversationId: string,
  currentUserId: string
): Promise<SharedLink[]> {
  const [msgsRes, deletionsRes] = await Promise.all([
    supabase
      .from("messages")
      .select("id, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("is_deleted", false)
      .eq("content_type", "text")
      .order("created_at", { ascending: false }),
    supabase
      .from("message_deletions")
      .select("message_id")
      .eq("user_id", currentUserId),
  ]);
  if (msgsRes.error) throw msgsRes.error;
  const myDeleted = new Set(
    (deletionsRes.data || []).map(
      (d: { message_id: string }) => d.message_id
    )
  );

  const out: SharedLink[] = [];
  for (const row of (msgsRes.data || []) as Array<{
    id: string;
    content: string | null;
    created_at: string;
  }>) {
    if (myDeleted.has(row.id)) continue;
    if (!row.content) continue;
    const matches = row.content.match(URL_REGEX);
    if (!matches) continue;
    for (const url of matches) {
      out.push({
        url,
        message_id: row.id,
        created_at: row.created_at,
        context: row.content.slice(0, 140),
      });
    }
  }
  return out;
}

/**
 * Incident URLs forwarded into this conversation — surfaced in the
 * chat-info sheet's "Incidents" tab. Newest first. We re-derive
 * the post id from the message body rather than persist a join,
 * because the canonical source of truth is still the `messages`
 * row; this keeps the forward flow a pure text-message insert.
 */
export interface SharedIncident {
  post_id: string;
  message_id: string;
  created_at: string;
}

const INCIDENT_URL_FETCH_REGEX =
  /https?:\/\/(?:www\.)?peja\.life\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export async function fetchSharedIncidents(
  conversationId: string,
  currentUserId: string
): Promise<SharedIncident[]> {
  const [msgsRes, deletionsRes] = await Promise.all([
    supabase
      .from("messages")
      .select("id, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("is_deleted", false)
      .eq("content_type", "text")
      .order("created_at", { ascending: false }),
    supabase
      .from("message_deletions")
      .select("message_id")
      .eq("user_id", currentUserId),
  ]);
  if (msgsRes.error) throw msgsRes.error;
  const myDeleted = new Set(
    (deletionsRes.data || []).map(
      (d: { message_id: string }) => d.message_id
    )
  );
  const out: SharedIncident[] = [];
  const seen = new Set<string>();
  for (const row of (msgsRes.data || []) as Array<{
    id: string;
    content: string | null;
    created_at: string;
  }>) {
    if (myDeleted.has(row.id)) continue;
    if (!row.content) continue;
    const m = row.content.match(INCIDENT_URL_FETCH_REGEX);
    if (!m) continue;
    const postId = m[1];
    // Same incident forwarded multiple times — show once, keyed by
    // the FIRST (most recent) occurrence so the tap target lands on
    // the latest share. Older duplicates fall through.
    if (seen.has(postId)) continue;
    seen.add(postId);
    out.push({
      post_id: postId,
      message_id: row.id,
      created_at: row.created_at,
    });
  }
  return out;
}

/**
 * Toggle the current user's block of the other user. Matches v1's pattern:
 * writes both `dm_blocks` (global block list) and the per-participant
 * `is_blocked` flag.
 */
export async function setBlocked(
  currentUserId: string,
  otherUserId: string,
  conversationId: string,
  blocked: boolean
): Promise<void> {
  if (blocked) {
    await supabase
      .from("dm_blocks")
      .insert({ blocker_id: currentUserId, blocked_id: otherUserId });
  } else {
    await supabase
      .from("dm_blocks")
      .delete()
      .eq("blocker_id", currentUserId)
      .eq("blocked_id", otherUserId);
  }
  await supabase
    .from("conversation_participants")
    .update({ is_blocked: blocked })
    .eq("conversation_id", conversationId)
    .eq("user_id", currentUserId);
}

/**
 * "Clear chat" — insert a message_deletions row for every message in
 * this conversation, for the current user only. The other side is
 * unaffected. Subsequent fetchThread calls filter these out.
 */
export async function clearChatForUser(
  conversationId: string,
  currentUserId: string
): Promise<void> {
  const { data: ids, error } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId);
  if (error) throw error;
  if (!ids || ids.length === 0) return;
  const rows = ids.map((m: { id: string }) => ({
    message_id: m.id,
    user_id: currentUserId,
  }));
  await supabase
    .from("message_deletions")
    .upsert(rows, { onConflict: "message_id,user_id" });
}

/**
 * "Delete chat" — clear all messages for me AND set hidden_at on my
 * participant row so the conversation drops out of my list. A newer
 * message from the other side automatically un-hides via
 * handleMessageInsert.
 */
export async function deleteChatForUser(
  conversationId: string,
  currentUserId: string
): Promise<void> {
  await clearChatForUser(conversationId, currentUserId);
  await supabase
    .from("conversation_participants")
    .update({ hidden_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", currentUserId);
}

/**
 * Mark every notification on the `notifications` table that points
 * at this conversation as read, for the current user. We match by
 * `data->>'conversationId'` (the field notifications.ts writes when
 * recording DM messages / reactions / blocks).
 *
 * Fire-and-forget from the caller — a failure here just leaves the
 * notification badge sitting at a stale count, which the next
 * notifications-page open will reconcile.
 */
export async function markChatNotificationsRead(
  conversationId: string,
  currentUserId: string
): Promise<void> {
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", currentUserId)
    .eq("is_read", false)
    .filter("data->>conversationId", "eq", conversationId);
}

/**
 * Clears the hidden_at flag on the current user's participant row.
 * Called by the realtime layer the first time a message arrives for a
 * hidden conversation — we want the new message to bring the chat back
 * into the list.
 */
export async function unhideConversation(
  conversationId: string,
  currentUserId: string
): Promise<void> {
  await supabase
    .from("conversation_participants")
    .update({ hidden_at: null })
    .eq("conversation_id", conversationId)
    .eq("user_id", currentUserId);
}

/**
 * "Delete for me" — insert a single row into message_deletions. The
 * UNIQUE (message_id, user_id) constraint means a repeat tap is a
 * no-op (upsert). The other side keeps seeing the message; the next
 * fetchThread filters it out for us, and the v2 store removes it
 * immediately for snappy UX.
 */
export async function deleteMessageForUser(
  messageId: string,
  currentUserId: string
): Promise<void> {
  await supabase
    .from("message_deletions")
    .upsert(
      { message_id: messageId, user_id: currentUserId },
      { onConflict: "message_id,user_id" }
    );
}

/**
 * Add a reaction. Returns the inserted row so the caller can patch
 * its temp-id optimistic copy with the real server id.
 */
export async function addReaction(
  messageId: string,
  userId: string,
  emoji: string
): Promise<MessageReaction> {
  const { data, error } = await supabase
    .from("message_reactions")
    .insert({ message_id: messageId, user_id: userId, emoji })
    .select("id, message_id, user_id, emoji, created_at")
    .single();
  if (error) throw error;
  return data as MessageReaction;
}

/**
 * Remove a reaction by id. Used by the toggle path when the user
 * taps their existing emoji off, and when they swap to a different
 * emoji (we delete the old then insert the new).
 */
export async function removeReaction(reactionId: string): Promise<void> {
  const { error } = await supabase
    .from("message_reactions")
    .delete()
    .eq("id", reactionId);
  if (error) throw error;
}

/**
 * Edit a text message. Updates `content` + stamps `edited_at`.
 * Server-side RLS already restricts UPDATE to the original sender so
 * we don't need a client guard. Realtime echoes the new content via
 * the messages UPDATE handler.
 *
 * Per HANDOFF.md, edits have NO time limit — the user explicitly
 * asked for open-ended editing.
 */
export async function editMessage(
  messageId: string,
  content: string
): Promise<{ edited_at: string }> {
  const editedAt = new Date().toISOString();
  const { error } = await supabase
    .from("messages")
    .update({ content, edited_at: editedAt })
    .eq("id", messageId);
  if (error) throw error;
  return { edited_at: editedAt };
}

/**
 * "Delete for everyone" — sets messages.is_deleted = true. Both sides
 * render the bubble as "Message deleted". RLS restricts UPDATE on
 * this column to the sender, so we don't need a client guard.
 */
export async function deleteMessageForEveryone(
  messageId: string
): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .update({ is_deleted: true })
    .eq("id", messageId);
  if (error) throw error;
}

// =====================================================
// New-DM picker (MVP / VIP gated)
// =====================================================

export interface VisibleElevatedUser {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_vip: boolean;
  is_mvp: boolean;
}

/**
 * List the MVP / VIP users the current user is allowed to start
 * a DM with. Backed by the SECURITY DEFINER RPC
 * `peja_visible_elevated_users` so the visibility rules are
 * enforced at the data layer — clients can't bypass them by
 * querying users directly.
 *
 * Regular users get an empty list. VIPs see only VIPs. MVPs see
 * MVPs + VIPs. Admins see everyone elevated.
 */
export async function fetchVisibleElevatedUsers(
  viewerId: string
): Promise<VisibleElevatedUser[]> {
  const { data, error } = await supabase.rpc("peja_visible_elevated_users", {
    viewer_id: viewerId,
  });
  if (error) throw error;
  return (data || []) as VisibleElevatedUser[];
}

/**
 * Find an existing DM with `otherUserId` or create one, gated by
 * the MVP / VIP rules. Returns the conversation id so the caller
 * can navigate straight to /messages/<id>.
 *
 * Surfaces a typed error when the gate fails so the UI can show a
 * friendly "you can't message this user" toast instead of a raw
 * Postgres exception.
 */
export class PermissionDeniedError extends Error {
  constructor(message = "Not allowed to message this user") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export async function findOrCreateDM(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("peja_find_or_create_dm", {
    other_user_id: otherUserId,
  });
  if (error) {
    // Postgres "42501 insufficient_privilege" is what our wrapper
    // RPC raises when peja_can_dm rejects the pair.
    if (error.code === "42501" || /Not allowed to message/i.test(error.message)) {
      throw new PermissionDeniedError(error.message);
    }
    throw error;
  }
  if (!data || typeof data !== "string") {
    throw new Error("No conversation id returned");
  }
  return data;
}

/**
 * Submit a user report. Fires from the chat-info sheet's "Report"
 * action and the header kebab. Reason is one of the canonical
 * categories the UI picker offers; notes is optional free-form
 * context typed by the reporter.
 *
 * Returns the inserted report id so the caller can show a "your
 * report has been submitted (ref #xxxxx)" confirmation if it wants.
 */
export type UserReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "explicit"
  | "impersonation"
  | "self_harm"
  | "other";

export async function submitUserReport(args: {
  reporterId: string;
  reportedId: string;
  conversationId?: string | null;
  // Optional — when a user reports a SPECIFIC message inside a
  // group, this links to it so the admin can jump straight to
  // the bubble in context. user_reports.message_id is nullable
  // for legacy / user-level reports.
  messageId?: string | null;
  reason: UserReportReason;
  notes?: string | null;
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("user_reports")
    .insert({
      reporter_id: args.reporterId,
      reported_id: args.reportedId,
      conversation_id: args.conversationId ?? null,
      message_id: args.messageId ?? null,
      reason: args.reason,
      notes: args.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

/**
 * Forward a single message into one or more conversations. Reuses
 * the existing send paths so the forwarded copies are indistinguishable
 * from a fresh compose:
 *   • text-only source → sendTextMessage per target
 *   • media source     → sendMediaMessage per target, pointing at the
 *                        SAME URLs (no re-upload), with fresh ids
 *
 * Reactions, reply_to, edited_at, is_deleted are NOT carried over —
 * matches WhatsApp / Telegram semantics. Returns the list of new
 * message ids so callers can patch optimistically.
 */
export async function forwardMessage(
  source: ChatMessage,
  targetConversationIds: string[],
  currentUserId: string
): Promise<{ targetConversationId: string; messageId: string }[]> {
  const out: { targetConversationId: string; messageId: string }[] = [];
  const hasMedia = !!(source.media && source.media.length > 0);
  const text = source.content?.trim() || null;
  if (!hasMedia && !text) return out;

  for (const cid of targetConversationIds) {
    const messageId = makeUuid();
    if (hasMedia) {
      await sendMediaMessage({
        id: messageId,
        conversation_id: cid,
        sender_id: currentUserId,
        caption: text,
        attachments: (source.media || []).map((m) => ({
          id: makeUuid(),
          url: m.url,
          media_type: m.media_type,
          file_name: m.file_name || "",
          file_size: m.file_size || 0,
          mime_type: m.mime_type || "",
          thumbnail_url: m.thumbnail_url,
        })),
      });
    } else if (text) {
      await sendTextMessage({
        id: messageId,
        conversation_id: cid,
        sender_id: currentUserId,
        content: text,
      });
    }
    out.push({ targetConversationId: cid, messageId });
  }
  return out;
}

function makeUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// =====================================================
// Groups (peja-only creation + management)
// =====================================================
//
// All five mutations go through SECURITY DEFINER RPCs that enforce
// "is this caller the peja super-admin" server-side. The thin
// wrappers here just surface typed errors so callers can show
// friendly toasts instead of bubbling Postgres exceptions.

import type { GroupParticipant } from "./types";

function isPermissionDenied(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42501") return true;
  return /Only the peja account|not authenticated/i.test(err.message || "");
}

/**
 * Create a new group. Members must already be elevated (MVP / VIP
 * / admin) — the RPC re-validates server-side. Returns the new
 * conversation id.
 */
export async function createGroup(args: {
  name: string;
  avatarUrl?: string | null;
  memberIds: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("peja_create_group", {
    p_name: args.name,
    p_avatar_url: args.avatarUrl ?? null,
    p_member_ids: args.memberIds,
  });
  if (error) {
    if (isPermissionDenied(error)) throw new PermissionDeniedError(error.message);
    throw error;
  }
  if (!data || typeof data !== "string") {
    throw new Error("No conversation id returned");
  }
  return data;
}

export async function addGroupMember(
  conversationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase.rpc("peja_group_add_member", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  if (error) {
    if (isPermissionDenied(error)) throw new PermissionDeniedError(error.message);
    throw error;
  }
}

export async function removeGroupMember(
  conversationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase.rpc("peja_group_remove_member", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  if (error) {
    if (isPermissionDenied(error)) throw new PermissionDeniedError(error.message);
    throw error;
  }
}

export async function renameGroup(
  conversationId: string,
  newName: string
): Promise<void> {
  const { error } = await supabase.rpc("peja_group_rename", {
    p_conversation_id: conversationId,
    p_new_name: newName,
  });
  if (error) {
    if (isPermissionDenied(error)) throw new PermissionDeniedError(error.message);
    throw error;
  }
}

export async function setGroupAvatar(
  conversationId: string,
  newAvatarUrl: string | null
): Promise<void> {
  const { error } = await supabase.rpc("peja_group_set_avatar", {
    p_conversation_id: conversationId,
    p_new_avatar_url: newAvatarUrl,
  });
  if (error) {
    if (isPermissionDenied(error)) throw new PermissionDeniedError(error.message);
    throw error;
  }
}

export async function leaveGroup(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("peja_group_leave", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

export async function deleteGroup(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("peja_group_delete", {
    p_conversation_id: conversationId,
  });
  if (error) {
    if (isPermissionDenied(error)) throw new PermissionDeniedError(error.message);
    throw error;
  }
}

/**
 * Group participant list — used by the chat-info sheet to render
 * the members tab and to label individual messages with the
 * sender's name. Returns participants in name order.
 */
/**
 * Upload a group avatar image to the shared "media" bucket (same
 * one regular user avatars live in) under the group-avatars/
 * prefix. Returns the public URL ready to drop into
 * conversations.group_avatar_url. We deliberately don't tear down
 * the old avatar — orphans there don't hurt much and we'd need a
 * separate sweep to handle race-y simultaneous edits cleanly.
 */
export async function uploadGroupAvatar(
  file: File,
  ownerId: string
): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : "jpg";
  const path = `group-avatars/${ownerId}-${Date.now()}.${safeExt}`;
  const { error } = await supabase.storage
    .from("media")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
  if (error) throw error;
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("avatar URL missing after upload");
  return data.publicUrl;
}

// =====================================================
// Conversation + message pinning
// =====================================================

export async function setConversationPinned(
  conversationId: string,
  pinned: boolean
): Promise<void> {
  const { error } = await supabase.rpc("peja_conv_set_pinned", {
    p_conversation_id: conversationId,
    p_pinned: pinned,
  });
  if (error) throw error;
}

export async function setMessagePinned(
  messageId: string,
  pinned: boolean
): Promise<void> {
  const { error } = await supabase.rpc("peja_message_set_pinned", {
    p_message_id: messageId,
    p_pinned: pinned,
  });
  if (error) throw error;
}

export type NotificationMode = "all" | "mentions" | "muted";

export async function setNotificationMode(
  conversationId: string,
  mode: NotificationMode
): Promise<void> {
  const { error } = await supabase.rpc("peja_conv_set_notification_mode", {
    p_conversation_id: conversationId,
    p_mode: mode,
  });
  if (error) throw error;
}

export interface PinnedMessage {
  id: string;
  content: string | null;
  content_type: string;
  sender_id: string;
  sender_name: string | null;
  pinned_at: string;
  created_at: string;
}

export async function fetchPinnedMessages(
  conversationId: string
): Promise<PinnedMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, content, content_type, sender_id, pinned_at, created_at")
    .eq("conversation_id", conversationId)
    .eq("is_pinned", true)
    .eq("is_deleted", false)
    .order("pinned_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const rows = (data || []) as Array<{
    id: string;
    content: string | null;
    content_type: string;
    sender_id: string;
    pinned_at: string;
    created_at: string;
  }>;
  if (rows.length === 0) return [];
  const senderIds = [...new Set(rows.map((r) => r.sender_id))];
  const { data: users } = await supabase
    .from("users")
    .select("id, full_name")
    .in("id", senderIds);
  const nameById: Record<string, string> = {};
  for (const u of (users || []) as Array<{ id: string; full_name: string | null }>) {
    nameById[u.id] = u.full_name || "";
  }
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    content_type: r.content_type,
    sender_id: r.sender_id,
    sender_name: nameById[r.sender_id] || null,
    pinned_at: r.pinned_at,
    created_at: r.created_at,
  }));
}

/**
 * Slim per-recipient list used by the client-side push fan-out
 * when sending into a group. Returns everyone EXCEPT the sender,
 * with the bits we need to decide whom to notify: notification
 * mode + full name (for handle-matching against the body's
 * @mentions). Notifications are best-effort; if this fetch fails
 * the caller swallows it and the receivers will still get the
 * message via realtime.
 */
export interface GroupNotifyRecipient {
  user_id: string;
  full_name: string | null;
  notification_mode: "all" | "mentions" | "muted";
}

export async function fetchGroupParticipantsForNotify(
  conversationId: string,
  senderId: string
): Promise<GroupNotifyRecipient[]> {
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("user_id, notification_mode")
    .eq("conversation_id", conversationId)
    .neq("user_id", senderId);
  if (error) throw error;
  const rows = (data || []) as Array<{
    user_id: string;
    notification_mode: "all" | "mentions" | "muted" | null;
  }>;
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => r.user_id);
  const { data: users } = await supabase
    .from("users")
    .select("id, full_name")
    .in("id", userIds);
  const nameById: Record<string, string | null> = {};
  for (const u of (users || []) as Array<{
    id: string;
    full_name: string | null;
  }>) {
    nameById[u.id] = u.full_name;
  }
  return rows.map((r) => ({
    user_id: r.user_id,
    full_name: nameById[r.user_id] ?? null,
    notification_mode:
      r.notification_mode === "mentions" || r.notification_mode === "muted"
        ? r.notification_mode
        : "all",
  }));
}

export async function fetchGroupParticipants(
  conversationId: string
): Promise<GroupParticipant[]> {
  const { data: parts, error } = await supabase
    .from("conversation_participants")
    .select("user_id, role")
    .eq("conversation_id", conversationId);
  if (error) throw error;
  const rows = (parts || []) as Array<{
    user_id: string;
    role: "owner" | "member" | null;
  }>;
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => r.user_id);
  const { data: users } = await supabase
    .from("users")
    .select("id, full_name, avatar_url, is_vip, is_mvp, is_admin")
    .in("id", userIds);
  const usersById: Record<string, {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    is_vip: boolean | null;
    is_mvp: boolean | null;
    is_admin: boolean | null;
  }> = {};
  for (const u of (users || []) as Array<{
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    is_vip: boolean | null;
    is_mvp: boolean | null;
    is_admin: boolean | null;
  }>) {
    usersById[u.id] = u;
  }
  const out: GroupParticipant[] = rows.map((r) => {
    const u = usersById[r.user_id];
    return {
      user_id: r.user_id,
      full_name: u?.full_name ?? null,
      avatar_url: u?.avatar_url ?? null,
      role: r.role === "owner" ? "owner" : "member",
      is_vip: !!u?.is_vip,
      is_mvp: !!u?.is_mvp,
      is_admin: !!u?.is_admin,
    };
  });
  out.sort((a, b) => {
    // Owner pinned to the top, then alphabetical by name.
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return (a.full_name || "").localeCompare(b.full_name || "");
  });
  return out;
}
