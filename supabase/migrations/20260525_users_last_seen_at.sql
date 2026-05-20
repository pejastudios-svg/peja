-- Cross-session "last seen" for v2 chat presence.
--
-- The live Supabase Realtime Presence channel ("peja-presence") tells every
-- connected client who is online RIGHT NOW. It does not tell anyone who
-- joins later when a previously-online user was last around — that needs a
-- persistent timestamp.
--
-- The chat clients heartbeat this column every ~30s while the app is in the
-- foreground, plus once on online + visibilitychange. On the conversation
-- list / thread page, we read it to render "last seen 5m ago" when the
-- other user is offline.
--
-- Indexed lightly because the read pattern is "lookup by user id" — already
-- the primary key — so no extra index is needed.

alter table public.users
  add column if not exists last_seen_at timestamptz;
