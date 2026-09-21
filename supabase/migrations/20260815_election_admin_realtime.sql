-- Admin page realtime + candidate editing.
--
-- 1. Publication: stream the remaining Election Watch tables. Uploads and
--    tallies were added by 20260813_election_realtime; this adds
--    elections, candidates, access and the ledger so the admin dashboard
--    (and viewer pages, for candidates) update without refresh.
--
-- 2. Policies: realtime respects RLS with the SUBSCRIBER'S identity, and
--    election_access / election_audit deliberately have no client read
--    policies, so their events would never reach the admin's browser.
--    These two policies open READ to admin accounts only. Everyone else
--    stays locked out exactly as before, and writes stay service-role
--    only everywhere.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'elections'
  ) then
    alter publication supabase_realtime add table public.elections;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'election_candidates'
  ) then
    alter publication supabase_realtime add table public.election_candidates;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'election_access'
  ) then
    alter publication supabase_realtime add table public.election_access;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'election_audit'
  ) then
    alter publication supabase_realtime add table public.election_audit;
  end if;
end $$;

drop policy if exists "admin reads election access" on public.election_access;
create policy "admin reads election access"
  on public.election_access for select
  to authenticated
  using (exists (
    select 1 from public.users u where u.id = auth.uid() and u.is_admin
  ));

drop policy if exists "admin reads election audit" on public.election_audit;
create policy "admin reads election audit"
  on public.election_audit for select
  to authenticated
  using (exists (
    select 1 from public.users u where u.id = auth.uid() and u.is_admin
  ));
