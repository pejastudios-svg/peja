-- PostGIS ships a reference table `public.spatial_ref_sys` (EPSG codes, etc.)
-- and Supabase's linter flags it "RLS Disabled in Public" because it sits in
-- an API-exposed schema without RLS enabled. On hosted Supabase the table is
-- owned by `supabase_admin`, so the project's `postgres` role CANNOT run
-- `ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY` — it errors
-- with "must be owner of table spatial_ref_sys".
--
-- The accepted mitigation:
--   1. Revoke API role access (below) so PostgREST can't read the table even
--      though RLS itself can't be enabled from the SQL editor.
--   2. Dismiss the linter finding in Database → Advisors. The data
--      (well-known spatial reference systems) is non-sensitive and identical
--      across every PostGIS install, so the warning is a known false positive
--      for this specific table.
--
-- PostGIS functions like ST_Transform continue to work because they read this
-- table via the `postgres`/`supabase_admin` roles, not via `anon`/`authenticated`.

revoke all on table public.spatial_ref_sys from anon, authenticated;
