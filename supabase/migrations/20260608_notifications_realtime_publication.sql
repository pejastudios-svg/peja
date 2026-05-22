-- Ensure public.notifications is broadcast on supabase_realtime so
-- the InAppNotificationToasts channel (postgres_changes INSERT
-- listener) fires when a row is inserted by /api/notify-social.
--
-- Symptom this fixes: sender logs `[chat-v2] notify <id> ok= true`,
-- server logs `[notify-social] DM decision { fullyMuted: false }` and
-- no insert error, but the receiver's console never logs
-- `[toasts] INSERT received`. Without the table on the publication,
-- the INSERT lands in the DB but no realtime event is broadcast.
--
-- Idempotent: `add table` errors if the table is already a member, so
-- we guard with a catalog lookup.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$$;
