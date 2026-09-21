-- Admin map at scale: one indexed position table, viewport queries,
-- server-side clustering, and a search that reaches people who are
-- nowhere near the current view.
--
-- THE PROBLEM. A person's location can come from three places that never
-- overlap: `presence` (written while the app is open on any platform,
-- and by the native Android ambient service while it is backgrounded or
-- closed), `users.last_*` (their last deliberate location), and
-- `devices.last_*` (the Beacon's own GPS, over GSM, independent of the
-- phone). Answering "who is in this view" therefore meant resolving the
-- freshest of three rows for every user before anything could be
-- filtered. That is whole-table work no index can avoid, and it is
-- repeated on every pan, by every admin, every thirty seconds.
--
-- THE FIX. Resolve it once at write time instead of every time at read
-- time. user_map_positions holds exactly one row per user: their current
-- best position. Triggers on all three sources keep it true. Every map
-- query then becomes a single indexed scan on one small table, which is
-- what makes a million users survivable: the cost tracks what is on
-- screen, not how many people exist.
--
-- Service-role only. These functions read location data that is
-- otherwise consent-gated by RLS on `presence`; that exposure is the
-- admin map's premise and is enforced at the API route, not here.

create extension if not exists "pg_trgm";

-- ── Source indexes. There were none on any location column. ──
create index if not exists presence_lat_lng_idx
  on public.presence (lat, lng);

create index if not exists users_last_location_idx
  on public.users (last_latitude, last_longitude)
  where last_latitude is not null and last_longitude is not null;

create index if not exists devices_last_fix_idx
  on public.devices (last_lat, last_lng)
  where last_lat is not null and last_lng is not null;

-- Name search: ILIKE '%x%' cannot use a btree, so trigrams.
create index if not exists users_full_name_trgm_idx
  on public.users using gin (full_name gin_trgm_ops);

-- ══ The denormalized truth ══
create table if not exists public.user_map_positions (
  user_id     uuid primary key references public.users(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  source      text not null check (source in ('presence','last_known','beacon')),
  captured_at timestamptz,
  updated_at  timestamptz not null default now()
);

-- The index the whole design rests on.
create index if not exists user_map_positions_lat_lng_idx
  on public.user_map_positions (lat, lng);
create index if not exists user_map_positions_captured_idx
  on public.user_map_positions (captured_at desc);

-- No policies on purpose: RLS on with none denies anon and authenticated
-- outright, leaving the service role as the only reader.
alter table public.user_map_positions enable row level security;

comment on table public.user_map_positions is
  'One current best position per user, resolved from presence, last activity and Beacon fixes at write time. Maintained by trigger. Service-role reads only.';

-- ══ Resolution: freshest of the three sources, for specific users ══
-- Priority is by timestamp, never by source: a Beacon fix from four
-- minutes ago should beat a presence row from two days ago.
create or replace function public.admin_user_positions_for(p_ids uuid[])
returns table (
  user_id     uuid,
  lat         double precision,
  lng         double precision,
  source      text,
  captured_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with candidates as (
    select p.user_id, p.lat, p.lng, 'presence'::text as source, p.captured_at
      from public.presence p
     where p.user_id = any(p_ids)
       and p.lat is not null and p.lng is not null
    union all
    select u.id, u.last_latitude, u.last_longitude, 'last_known'::text, u.last_location_updated_at
      from public.users u
     where u.id = any(p_ids)
       and u.last_latitude is not null and u.last_longitude is not null
    union all
    select d.user_id, d.last_lat, d.last_lng, 'beacon'::text, d.last_fix_at
      from public.devices d
     where d.user_id = any(p_ids)
       and d.last_lat is not null and d.last_lng is not null
       and d.status <> 'unpaired'
  )
  select distinct on (c.user_id)
         c.user_id, c.lat, c.lng, c.source, c.captured_at
    from candidates c
   order by c.user_id, c.captured_at desc nulls last;
$$;

-- ══ Keeping it true ══
create or replace function public.refresh_user_map_position(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_src text;
  v_at  timestamptz;
begin
  if p_user is null then return; end if;

  select q.lat, q.lng, q.source, q.captured_at
    into v_lat, v_lng, v_src, v_at
    from public.admin_user_positions_for(array[p_user]) q
   limit 1;

  if v_lat is null or v_lng is null then
    -- Every source went away (device unpaired, row deleted). Drop the
    -- cached position rather than leaving a ghost on the map.
    delete from public.user_map_positions where user_id = p_user;
    return;
  end if;

  insert into public.user_map_positions (user_id, lat, lng, source, captured_at, updated_at)
  values (p_user, v_lat, v_lng, v_src, v_at, now())
  on conflict (user_id) do update
     set lat         = excluded.lat,
         lng         = excluded.lng,
         source      = excluded.source,
         captured_at = excluded.captured_at,
         updated_at  = now();
end;
$$;

create or replace function public.trg_refresh_position_presence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- NEW is unassigned on DELETE, so it cannot be referenced there.
  if tg_op = 'DELETE' then
    perform public.refresh_user_map_position(old.user_id);
  else
    perform public.refresh_user_map_position(new.user_id);
  end if;
  return null;
end; $$;

create or replace function public.trg_refresh_position_users()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_user_map_position(new.id);
  return null;
end; $$;

create or replace function public.trg_refresh_position_devices()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_user_map_position(old.user_id);
  else
    -- An owner transfer leaves the previous owner stale too.
    if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
      perform public.refresh_user_map_position(old.user_id);
    end if;
    perform public.refresh_user_map_position(new.user_id);
  end if;
  return null;
end; $$;

drop trigger if exists presence_refresh_map_position on public.presence;
create trigger presence_refresh_map_position
  after insert or update or delete on public.presence
  for each row execute function public.trg_refresh_position_presence();

-- Only when the location columns actually move: `users` is updated for
-- all sorts of reasons and none of the others concern the map.
drop trigger if exists users_refresh_map_position on public.users;
create trigger users_refresh_map_position
  after update of last_latitude, last_longitude, last_location_updated_at
  on public.users
  for each row execute function public.trg_refresh_position_users();

drop trigger if exists devices_refresh_map_position on public.devices;
create trigger devices_refresh_map_position
  after insert or update of last_lat, last_lng, last_fix_at, status, user_id
  or delete on public.devices
  for each row execute function public.trg_refresh_position_devices();

-- ══ Backfill ══
with candidates as (
  select p.user_id, p.lat, p.lng, 'presence'::text as source, p.captured_at
    from public.presence p
   where p.lat is not null and p.lng is not null
  union all
  select u.id, u.last_latitude, u.last_longitude, 'last_known'::text, u.last_location_updated_at
    from public.users u
   where u.last_latitude is not null and u.last_longitude is not null
  union all
  select d.user_id, d.last_lat, d.last_lng, 'beacon'::text, d.last_fix_at
    from public.devices d
   where d.last_lat is not null and d.last_lng is not null
     and d.status <> 'unpaired'
)
insert into public.user_map_positions (user_id, lat, lng, source, captured_at)
select distinct on (c.user_id) c.user_id, c.lat, c.lng, c.source, c.captured_at
  from candidates c
 order by c.user_id, c.captured_at desc nulls last
on conflict (user_id) do update
   set lat         = excluded.lat,
       lng         = excluded.lng,
       source      = excluded.source,
       captured_at = excluded.captured_at,
       updated_at  = now();

-- ══ The read path: every one of these is a single indexed scan ══

create or replace function public.admin_user_positions_count(
  p_west  double precision,
  p_south double precision,
  p_east  double precision,
  p_north double precision
)
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)::bigint
    from public.user_map_positions m
   where m.lat between p_south and p_north
     and m.lng between p_west  and p_east;
$$;

-- Newest fix first, so a truncated result is the most current people
-- rather than an arbitrary slice.
create or replace function public.admin_user_positions_bbox(
  p_west  double precision,
  p_south double precision,
  p_east  double precision,
  p_north double precision,
  p_limit int default 400
)
returns table (
  user_id     uuid,
  lat         double precision,
  lng         double precision,
  source      text,
  captured_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select m.user_id, m.lat, m.lng, m.source, m.captured_at
    from public.user_map_positions m
   where m.lat between p_south and p_north
     and m.lng between p_west  and p_east
   order by m.captured_at desc nulls last
   limit greatest(1, least(p_limit, 2000));
$$;

-- Zoomed out: counts per grid cell, never rows. p_precision is decimal
-- places, derived from zoom on the client, so a view of the whole
-- country costs a few hundred bytes whether it holds forty people or
-- four million.
create or replace function public.admin_user_clusters(
  p_west      double precision,
  p_south     double precision,
  p_east      double precision,
  p_north     double precision,
  p_precision int default 1
)
returns table (
  lat double precision,
  lng double precision,
  cnt bigint
)
language sql
stable
set search_path = public
as $$
  select round(m.lat::numeric, p_precision)::double precision as lat,
         round(m.lng::numeric, p_precision)::double precision as lng,
         count(*)::bigint as cnt
    from public.user_map_positions m
   where m.lat between p_south and p_north
     and m.lng between p_west  and p_east
   group by 1, 2
   order by cnt desc
   limit 2000;
$$;

-- Search ignores the viewport on purpose: an admin looking for a name
-- during an incident must find that person whether or not the map is
-- pointed at them. Names are matched and capped first, so positions are
-- joined for only the handful that matched. People with no known
-- position still come back, with null coordinates: "we cannot place
-- them" is a useful answer, silence is not.
create or replace function public.admin_user_search(
  p_q     text,
  p_limit int default 20
)
returns table (
  user_id     uuid,
  lat         double precision,
  lng         double precision,
  source      text,
  captured_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with matched as (
    select u.id
      from public.users u
     where u.full_name ilike '%' || p_q || '%'
     limit greatest(1, least(p_limit, 50))
  )
  select m.id, p.lat, p.lng, p.source, p.captured_at
    from matched m
    left join public.user_map_positions p on p.user_id = m.id
   order by (p.lat is null), p.captured_at desc nulls last;
$$;

comment on function public.admin_user_positions_for is
  'Freshest position for the given users across presence, last activity and Beacon fixes. Used by the refresh trigger; not a read path.';

-- ══ Access ══
-- These functions exist for the admin map and nothing else. The read
-- paths are already blocked by RLS on user_map_positions (enabled with
-- no policies), but revoking execute makes the intent explicit and
-- closes the SECURITY DEFINER refresher, which would otherwise be
-- callable by any signed-in user.
revoke all on function public.admin_user_positions_for(uuid[]) from anon, authenticated;
revoke all on function public.refresh_user_map_position(uuid) from anon, authenticated;
revoke all on function public.admin_user_positions_count(double precision, double precision, double precision, double precision) from anon, authenticated;
revoke all on function public.admin_user_positions_bbox(double precision, double precision, double precision, double precision, int) from anon, authenticated;
revoke all on function public.admin_user_clusters(double precision, double precision, double precision, double precision, int) from anon, authenticated;
revoke all on function public.admin_user_search(text, int) from anon, authenticated;

grant execute on function public.admin_user_positions_for(uuid[]) to service_role;
grant execute on function public.refresh_user_map_position(uuid) to service_role;
grant execute on function public.admin_user_positions_count(double precision, double precision, double precision, double precision) to service_role;
grant execute on function public.admin_user_positions_bbox(double precision, double precision, double precision, double precision, int) to service_role;
grant execute on function public.admin_user_clusters(double precision, double precision, double precision, double precision, int) to service_role;
grant execute on function public.admin_user_search(text, int) to service_role;
