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
  // UI state, not persisted. "pending" → on the wire. "sent" → server
  // confirmed via realtime. "seen" → recipient's read receipt arrived.
  // "failed" → insert errored; user can retry.
  delivery_status: DeliveryStatus;
  // Attached media for this message — hydrated from the `message_media`
  // table on fetch, populated optimistically on send. Empty / undefined
  // for text messages.
  media?: ChatMessageMedia[];
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
