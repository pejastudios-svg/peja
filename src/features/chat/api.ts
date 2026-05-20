// Supabase data layer for the v2 chat. Pure functions that read or write
// the DB and return shaped data. They never touch the store directly —
// callers (provider, page hooks) decide what to do with the result.

import { supabase } from "@/lib/supabase";
import type {
  ChatConversationSummary,
  ChatMessage,
  ChatMessageMedia,
  DeliveryStatus,
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
}

interface ParticipantRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
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
  //    last_read_at for unread counting).
  const { data: myParts, error: e1 } = await supabase
    .from("conversation_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", currentUserId);
  if (e1) throw e1;
  if (!myParts || myParts.length === 0) return [];

  const conversationIds = myParts.map((p) => p.conversation_id);
  const myReadByConv: Record<string, string | null> = {};
  for (const p of myParts) myReadByConv[p.conversation_id] = p.last_read_at;

  // 2. Conversations + other participants + their users — in parallel.
  const [convRes, otherPartRes] = await Promise.all([
    supabase.from("conversations").select("*").in("id", conversationIds),
    supabase
      .from("conversation_participants")
      .select("conversation_id, user_id, last_read_at")
      .in("conversation_id", conversationIds)
      .neq("user_id", currentUserId),
  ]);
  if (convRes.error) throw convRes.error;
  if (otherPartRes.error) throw otherPartRes.error;

  const convs = (convRes.data || []) as ConversationRow[];
  const otherParts = (otherPartRes.data || []) as ParticipantRow[];

  const otherByConv: Record<string, ParticipantRow> = {};
  for (const p of otherParts) otherByConv[p.conversation_id] = p;

  const otherUserIds = [
    ...new Set(otherParts.map((p) => p.user_id).filter(Boolean)),
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

  // 4. Assemble.
  const result: ChatConversationSummary[] = [];
  for (const conv of convs) {
    const other = otherByConv[conv.id];
    if (!other) continue; // Orphaned DM (other participant missing) — skip.
    const otherUser = usersById[other.user_id];

    let last_message_seen = false;
    if (
      conv.last_message_sender_id === currentUserId &&
      conv.last_message_at &&
      other.last_read_at &&
      new Date(other.last_read_at) >= new Date(conv.last_message_at)
    ) {
      last_message_seen = true;
    }

    result.push({
      id: conv.id,
      other_user_id: other.user_id,
      other_user_name: otherUser?.full_name ?? null,
      other_user_avatar_url: otherUser?.avatar_url ?? null,
      other_user_last_seen_at: otherUser?.last_seen_at ?? null,
      last_message_text: conv.last_message_text,
      last_message_at: conv.last_message_at,
      last_message_sender_id: conv.last_message_sender_id,
      last_message_seen,
      unread_count: unreadByConv[conv.id] || 0,
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
  limit = 50
): Promise<ChatMessage[]> {
  // Fetch messages + the other user's last_read_at in parallel.
  const [msgsRes, partsRes] = await Promise.all([
    supabase
      .from("messages")
      .select("id, conversation_id, sender_id, content, content_type, created_at, edited_at, is_deleted, reply_to_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("conversation_participants")
      .select("user_id, last_read_at")
      .eq("conversation_id", conversationId)
      .neq("user_id", currentUserId),
  ]);
  if (msgsRes.error) throw msgsRes.error;
  if (partsRes.error) throw partsRes.error;

  const rows = ((msgsRes.data || []) as MessageRow[]).reverse(); // chronological
  const otherLastRead = partsRes.data?.[0]?.last_read_at || null;

  // Fetch media in one round-trip for any non-text rows. Reduces the open
  // chat to two parallel queries even when the thread is a mix of text
  // and images.
  const mediaCarriers = rows.filter((r) => r.content_type !== "text").map((r) => r.id);
  const mediaByMessage = mediaCarriers.length
    ? await fetchMediaForMessages(mediaCarriers)
    : {};

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
    delivery_status: computeDeliveryStatus(row, currentUserId, otherLastRead),
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
 */
export async function markConversationRead(
  conversationId: string,
  currentUserId: string
): Promise<void> {
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
}
