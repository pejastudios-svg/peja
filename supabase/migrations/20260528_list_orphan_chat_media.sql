-- Companion to the /api/cron/cleanup-orphan-chat-media route.
--
-- The route can't query `storage.objects` directly through PostgREST
-- because Supabase doesn't expose the storage schema by default, and
-- it can't DELETE from it because protect_delete() blocks raw deletes.
-- The pattern that works:
--
--   1. This SECURITY DEFINER function runs as superuser-ish, can read
--      storage.objects, and returns the list of orphan paths to the
--      service-role client.
--   2. The Node.js route then calls supabase.storage.from(BUCKET)
--      .remove(paths) — that hits the Storage API, which is the
--      privileged path that respects accounting + bypasses
--      protect_delete.
--
-- We split list and delete on purpose: the delete must go through the
-- Storage API, but the listing logic (with the cross-table join
-- against message_media.url) is much cleaner in SQL than over the
-- network.

create or replace function public.peja_list_orphan_chat_media(
  grace_minutes int default 60
)
returns table (name text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  return query
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = 'message-media'
    and o.created_at < now() - (grace_minutes || ' minutes')::interval
    and not exists (
      select 1 from public.message_media mm
      where mm.url like '%' || o.name
    )
  limit 5000;
end;
$$;

-- Lock down execute permissions — only the service role (used by the
-- cron route) should be able to call this. authenticated + anon
-- shouldn't be able to enumerate storage paths even read-only.
revoke all on function public.peja_list_orphan_chat_media(int) from public;
grant execute on function public.peja_list_orphan_chat_media(int) to service_role;

comment on function public.peja_list_orphan_chat_media(int) is
  'Returns the path + created_at of every object in `message-media`
   older than grace_minutes that has no matching message_media.url.
   Intended for the cleanup cron at /api/cron/cleanup-orphan-chat-media.
   The route then deletes the listed paths via the Storage API.';
