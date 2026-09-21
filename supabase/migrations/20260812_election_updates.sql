-- Election Watch follow-ups: GPS on tallies too ("every action captures
-- location"), same honesty rule as uploads: absence is allowed, lying is
-- visible. Apply after 20260812_election_watch.sql.

alter table public.election_tallies
  add column if not exists device_lat double precision,
  add column if not exists device_lng double precision;
