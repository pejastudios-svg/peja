-- Speed up /api/notify-social's lookup pass. The route filters
-- notifications by (user_id, type, data->>'conversation_id') with
-- is_read = false to decide whether to enter digest mode. Without
-- a functional index on the JSONB extraction, Postgres seq-scans
-- every unread row for the user+type combo. Timing measurements
-- showed ~1.5s of in-Postgres work for this lookup on a small
-- dataset; the cost grows linearly with the notifications table.
--
-- The partial WHERE (is_read = false) keeps the index small —
-- read notifications dominate the table over time and don't need
-- to be in this index.
create index if not exists idx_notifications_user_type_conv_unread
  on public.notifications (user_id, type, (data->>'conversation_id'))
  where is_read = false;

-- Same shape for the social path which filters by post_id instead.
create index if not exists idx_notifications_user_type_post_unread
  on public.notifications (user_id, type, (data->>'post_id'))
  where is_read = false;

-- The mute-check select in handleDM hits this exact pair on every
-- notify call. If a PK already covers (conversation_id, user_id)
-- this is a no-op; the IF NOT EXISTS guard keeps it safe.
create index if not exists idx_conv_participants_conv_user
  on public.conversation_participants (conversation_id, user_id);
