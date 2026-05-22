-- v2 chat: "Delete chat" needs to hide a conversation from the
-- current user's conversation list without affecting the other
-- participant's view. We track this per-participant — when set,
-- the conversation list filters this row out client-side until a
-- new message arrives from the other side, at which point the
-- realtime layer clears the flag (see fetchConversationList +
-- handleMessageInsert).

alter table public.conversation_participants
  add column if not exists hidden_at timestamptz;

comment on column public.conversation_participants.hidden_at is
  'Per-user "delete chat" timestamp. When set, the v2 conversation
   list excludes this row UNTIL a newer message arrives, which clears
   the field. NULL means visible (default).';
