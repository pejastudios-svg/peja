-- Make the live map actually live. Supabase Realtime only streams changes
-- for tables in the supabase_realtime publication; without this the map
-- home's realtime subscription receives nothing and silently falls back
-- to the 45s poll.
--
-- RLS still applies to realtime: a subscriber only receives row changes
-- they are allowed to SELECT, so this exposes nothing beyond what the
-- existing policies already permit.
--
-- Idempotent: skip a table if it's already in the publication.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'presence'
  ) then
    alter publication supabase_realtime add table public.presence;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'safety_checkins'
  ) then
    alter publication supabase_realtime add table public.safety_checkins;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sos_alerts'
  ) then
    alter publication supabase_realtime add table public.sos_alerts;
  end if;
end $$;
