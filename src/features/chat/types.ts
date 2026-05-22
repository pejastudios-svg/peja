// Internal types for the v2 messaging system. Kept narrow on purpose — only
// the fields v2 actually uses. We re-derive on read from the Supabase rows
// (which have many more columns the legacy v1 needed) so changes to the DB
// schema don't cascade into UI components.

export type DeliveryStatus = "pending" | "sent" | "seen" | "failed";

export interface ChatMessage {
  // Client-generated UUIDv4 used as the row's `id` from the moment the user
  // taps send. No temp-id → real-id swap dance; the optimistic message IS
  // the real message, just not server-confirmed yet.
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  // Mirrors v1's set so we can re-use the same `messages.content_type` DB
  // column. Phase 1 only emitted "text"; Phase 3 adds "media" (images,
  // later video/audio); document/post_share/system are reserved for
  // later phases.
  content_type: "text" | "media" | "document" | "post_share" | "system";
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  reply_to_id: string | null;
  // Snapshot of the parent message this is a reply to. Hydrated on
  // fetch + realtime, populated optimistically on send. Lightweight on
  // purpose — just enough to render the quoted-reference bubble; we
  // never use it to drive logic beyond display.
  reply_to?: ReplyTarget | null;
  // UI state, not persisted. "pending" → on the wire. "sent" → server
  // confirmed via realtime. "seen" → recipient's read receipt arrived.
  // "failed" → insert errored; user can retry.
  delivery_status: DeliveryStatus;
  // Attached media for this message — hydrated from the `message_media`
  // table on fetch, populated optimistically on send. Empty / undefined
  // for text messages.
  media?: ChatMessageMedia[];
  // Emoji reactions on this message — multiple users can react, the
  // same user may react with multiple emojis. We render a grouped
  // badge cluster (👍 2 / ❤️ 1 / …) on the bubble.
  reactions?: MessageReaction[];
  // Per-conversation pinning. Any participant can pin or unpin —
  // pinned messages surface in the pinned-bar above the thread.
  is_pinned?: boolean;
  pinned_at?: string | null;
}

// One row of the `message_reactions` table. v2 keeps the legacy v1
// shape so the existing data is forward-compatible — same columns,
// same constraints, no migration needed.
export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

// Minimal snapshot of the parent message that a reply is referencing.
// Stored on the reply itself (not re-fetched per-render) so the
// quoted-reference block in the bubble doesn't have to do a network
// trip when scrolling.
export interface ReplyTarget {
  id: string;
  sender_id: string;
  content: string | null;
  is_deleted: boolean;
  // Coarse preview kind so we can show "📷 Photo" / "🎙 Voice note"
  // when the parent was media-only. Derived from message_media for
  // media parents, or "text" for text-only parents.
  preview_kind: "text" | "image" | "video" | "audio" | "document";
}

// One row of the `message_media` table. We use the same shape v1 used so
// existing player/lightbox components (VoiceNotePlayer etc.) drop in.
export interface ChatMessageMedia {
  id: string;
  message_id: string;
  url: string;
  media_type: "image" | "video" | "document" | "audio";
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  thumbnail_url: string | null;
  created_at: string;
  // Client-only: blob: URL used while the file is still uploading. The
  // store swaps this for the authoritative public URL once the upload
  // completes. Not persisted to the outbox; rebuilt from IDB on rehydrate.
  optimistic?: boolean;
  // Natural pixel dimensions, read from the file before the optimistic
  // add so the bubble can reserve aspect-ratio'd space immediately. Not
  // currently persisted server-side (no `message_media.width/height`
  // columns), so they're populated for sender-optimistic flows and
  // remain undefined when this object came back from the DB.
  width?: number;
  height?: number;
}

export interface ChatConversationSummary {
  id: string;
  other_user_id: string;
  other_user_name: string | null;
  other_user_avatar_url: string | null;
  // Persisted "last seen" from users.last_seen_at — populated server-side
  // by the v2 heartbeat. Used to render "last seen X ago" when the other
  // user is offline and we never observed them go offline this session
  // (so the live presence lastSeenByUserId is empty for them).
  other_user_last_seen_at: string | null;
  // Mirror of conversations.last_message_text / _at — these are updated by
  // the new Postgres trigger when a message is inserted, so they're
  // authoritative server-side. v2 never patches them client-side.
  last_message_text: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  // Whether the other user has read up to `last_message_at`. Drives the
  // double-tick "seen" indicator in the list.
  last_message_seen: boolean;
  unread_count: number;
  // Per-user moderation flags read from conversation_participants for the
  // CURRENT user (mirrors v1's chat). is_muted silences notifications for
  // this conversation. is_blocked means I've blocked the other user (also
  // backed by the global `dm_blocks` table).
  is_muted: boolean;
  is_blocked: boolean;
  // True when the OTHER participant has set their own is_blocked flag —
  // i.e., they've blocked me. Drives the in-thread "you've been blocked"
  // banner that replaces the composer.
  blocked_by_other: boolean;
  // My own last_read_at from conversation_participants. Used by the
  // thread page to render the "Unread messages" divider above the
  // first message that arrived after I last read the chat. Snapshotted
  // at mount time so the divider stays put even as the live read
  // pointer advances.
  my_last_read_at: string | null;
  // Per-user pinning. Pinned conversations sort to the top of the
  // list regardless of last_message_at. is_pinned drives the
  // indicator + the kebab toggle; pinned_at is the secondary sort
  // key when multiple pins exist (most recent pin first).
  is_pinned?: boolean;
  pinned_at?: string | null;
  // Per-user notification mode. 'all' is the default; 'mentions'
  // only fires for @mentions in groups; 'muted' suppresses all
  // notifications. is_muted (legacy boolean) is kept in lock step
  // by the RPC so older readers still see the right value.
  notification_mode?: "all" | "mentions" | "muted";
  // Group-chat metadata. is_group flips the row into "group mode" —
  // the other_user_* fields stay populated for backward compatibility
  // (set to the group's name / avatar so the list / header render
  // cleanly without branching) but the group_* fields are the source
  // of truth.
  is_group: boolean;
  group_name: string | null;
  group_avatar_url: string | null;
  // Total participant count for groups — drives the "12 members"
  // subtitle in the thread header. Always 2 for DMs (left undefined
  // there to keep the DM render path untouched).
  member_count?: number;
  // My own role inside the group. 'owner' grants member-management
  // controls in the chat-info sheet; 'member' shows only the Leave
  // button. Undefined for DMs.
  my_role?: "owner" | "member";
}

export interface GroupParticipant {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: "owner" | "member";
  is_vip: boolean;
  is_mvp: boolean;
  is_admin: boolean;
}

// Per-conversation thread slice held in the store. Separated from the
// conversation summary so the list can re-render without re-rendering
// every open thread.
export interface ChatThread {
  conversationId: string;
  messages: ChatMessage[];
  // True once we've completed at least one fresh DB fetch since the store
  // was created. Drives the difference between "empty chat" and "still
  // loading".
  hydrated: boolean;
  // Last successful fetch timestamp. Used to decide when to refetch in
  // the background on resume.
  fetchedAt: number | null;
}

// A message waiting in the persistent outbox (localStorage). The same UUID
// also exists in the store as a "pending" or "failed" message. Outbox is
// the durable copy that survives reloads; the store is the live view.
//
// Image / media support: the binary blobs themselves live in a separate
// IndexedDB store (localStorage can't hold them), keyed by message id.
// The OutboxItem holds only the *metadata* (filename, mime type, size)
// so the drain code knows what to upload back out.
export interface OutboxItem {
  id: string;
  conversation_id: string;
  sender_id: string;
  // Text caption — may be empty when the message is purely a media send.
  content: string;
  // Optimistic timestamp written when the user first tapped send. Server
  // assigns the real value when the row finally inserts — until then this
  // drives sort order in the UI.
  created_at: string;
  // Bump on every drain attempt so we can show "retrying…" / cap retries.
  attempts: number;
  // Last error message, if the most recent attempt failed.
  last_error?: string | null;
  // If present, this is a media (image, later video/audio) message. The
  // actual File blobs live in IndexedDB under the same message id; this
  // is just the manifest the drain needs to reupload after a reload.
  // For pure text messages, leave undefined.
  media?: OutboxMediaAttachment[];
}

export interface OutboxMediaAttachment {
  // Unique id for this attachment — used to address the blob in IDB so
  // a message with multiple attachments stays addressable per-file.
  attachment_id: string;
  // Where this attachment maps in `message_media.media_type`.
  media_type: "image" | "video" | "audio" | "document";
  file_name: string;
  mime_type: string;
  size: number;
  // Set ONCE the upload succeeds but the message-row insert hasn't yet.
  // Lets a mid-drain retry skip re-uploading already-stored bytes.
  uploaded_url?: string | null;
}
