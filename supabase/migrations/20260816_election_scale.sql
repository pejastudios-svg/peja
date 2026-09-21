-- Scale: push the two hot aggregations into Postgres.
--
-- Before this, the browse endpoint pulled EVERY upload row of an election
-- to count sheets per state/LGA in JavaScript, and the list endpoint
-- pulled EVERY live tally to sum candidate totals. Fine at 4 sheets,
-- fatal at fifty thousand: row transfer scales linearly with the
-- election, per viewer, per refresh. These two functions return the
-- aggregates instead, so a national election costs each refresh a few
-- hundred bytes, not megabytes, and the debounced realtime refetch stays
-- cheap no matter how fast the MVPs work.
--
-- Called via the service role from API routes only; both are STABLE and
-- read-only.

create or replace function public.election_geo_index(p_election uuid)
returns table (state text, lga text, sheet_count bigint)
language sql
stable
set search_path = public
as $$
  select u.state, u.lga, count(*)::bigint
  from public.election_uploads u
  where u.election_id = p_election
    and u.hidden = false
  group by u.state, u.lga;
$$;

create or replace function public.election_totals(p_election uuid)
returns table (candidate_id text, votes bigint)
language sql
stable
set search_path = public
as $$
  select f.key as candidate_id, sum((f.value)::bigint) as votes
  from public.election_tallies t
  join public.election_uploads u on u.id = t.upload_id
  cross join lateral jsonb_each_text(t.figures) as f(key, value)
  where t.election_id = p_election
    and t.superseded_by is null
    and (u.hidden = false or u.tallies_hidden = false)
    and f.value ~ '^[0-9]+$'
  group by f.key;
$$;

-- Scoped totals for the drill-down (state or LGA view).
create or replace function public.election_totals_scoped(
  p_election uuid,
  p_state text default null,
  p_lga text default null
)
returns table (candidate_id text, votes bigint)
language sql
stable
set search_path = public
as $$
  select f.key as candidate_id, sum((f.value)::bigint) as votes
  from public.election_tallies t
  join public.election_uploads u on u.id = t.upload_id
  cross join lateral jsonb_each_text(t.figures) as f(key, value)
  where t.election_id = p_election
    and t.superseded_by is null
    and (u.hidden = false or u.tallies_hidden = false)
    and (p_state is null or u.state = p_state)
    and (p_lga is null or u.lga = p_lga)
    and f.value ~ '^[0-9]+$'
  group by f.key;
$$;
