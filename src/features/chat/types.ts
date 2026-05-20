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
  // column. Phase 1 only emits "text"; later phases extend.
  content_type: "text" | "media" | "document" | "post_share" | "system";
  created_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  reply_to_id: string | null;
  // UI state, not persisted. "pending" → on the wire. "sent" → server
  // confirmed via realtime. "seen" → recipient's read receipt arrived.
  // "failed" → insert errored; user can retry.
  delivery_status: DeliveryStatus;
}

export interface ChatConversationSummary {
  id: string;
  other_user_id: string;
  other_user_name: string | null;
  other_user_avatar_url: string | null;
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
export interface OutboxItem {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  // Optimistic timestamp written when the user first tapped send. Server
  // assigns the real value when the row finally inserts — until then this
  // drives sort order in the UI.
  created_at: string;
  // Bump on every drain attempt so we can show "retrying…" / cap retries.
  attempts: number;
  // Last error message, if the most recent attempt failed.
  last_error?: string | null;
}
