-- Adds posts.country_code so notification fan-out and the Nearby
-- feed can gate by country precisely instead of matching place-name
-- strings (which collide: Lagos NG vs Lagos PT, Eastport US vs
-- equivalents elsewhere).
--
-- New posts get this populated from Nominatim's addressdetails at
-- creation time. Legacy posts stay NULL; consumers fall back to a
-- bounding-box check against (latitude, longitude) so we don't have
-- to re-geocode the entire backfill.
--
-- ISO 3166-1 alpha-2 codes, lowercase (matches Nominatim output).

alter table public.posts
  add column if not exists country_code text;

-- Partial index so the all_nigeria filter (`country_code = 'ng'`)
-- doesn't scan rows where the column hasn't been backfilled yet.
create index if not exists idx_posts_country_code_ng
  on public.posts (created_at desc)
  where country_code = 'ng';
