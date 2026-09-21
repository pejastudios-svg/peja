-- Live results: stream election evidence and tallies to viewers.
--
-- The client listens on ONE channel per open election and reacts with a
-- debounced refetch (bursts of tallies collapse into one browse call),
-- so the database sees at most one aggregate query per viewer per few
-- seconds no matter how fast the MVPs work. Read exposure is unchanged:
-- realtime respects the same read-only RLS as the tables themselves.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'election_uploads'
  ) then
    alter publication supabase_realtime add table public.election_uploads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'election_tallies'
  ) then
    alter publication supabase_realtime add table public.election_tallies;
  end if;
end $$;
