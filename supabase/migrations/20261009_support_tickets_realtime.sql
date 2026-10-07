-- Publish support_tickets so /admin/support updates without a refresh.
--
-- The page has subscribed to postgres_changes on this table since it was
-- built, but a table that is not in the supabase_realtime publication
-- emits nothing, so the subscription sat there receiving silence and
-- tickets only appeared on a manual refresh.
--
-- This matters more now than it did: a lockout request is someone saying
-- they cannot get into a personal-safety app. Waiting for whenever the
-- admin happens to reload the page is the wrong latency for that.
--
-- Realtime still respects RLS, so this does not widen who can see what.
-- Admins read every row through the existing admin policy
-- (20260519_support_tickets_admin_policy.sql) and everyone else keeps
-- seeing only their own.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_tickets'
  ) then
    execute 'alter publication supabase_realtime add table public.support_tickets';
  end if;
end $$;

-- Realtime sends only the primary key on UPDATE/DELETE unless the table
-- replicates full rows. The admin page refetches on any event rather than
-- patching from the payload, so this is not strictly required, but it
-- makes the payloads useful if that ever changes.
alter table public.support_tickets replica identity full;
