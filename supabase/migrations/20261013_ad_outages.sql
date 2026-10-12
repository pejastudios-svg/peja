-- Outages, and the credit given for them.
--
-- When serving breaks, every advertiser who was live at the time has lost
-- days they paid for. At a few hundred placements that could be handled by
-- hand; at fifty thousand it cannot, so the credit has to fan out from one
-- declaration.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: infer an outage from missing
-- impressions. A placement with no views might mean serving broke, or it
-- might mean nobody opened the app in that LGA that day, and nothing in
-- the data distinguishes them. Guessing either robs advertisers or gives
-- away free days at scale. So a human declares the window and the system
-- does the arithmetic. Impressions are never consulted.

create extension if not exists "pgcrypto";

create table if not exists public.ad_outages (
  id uuid primary key default gen_random_uuid(),

  -- The window that was lost. Everything is derived from these two.
  started_at timestamptz not null,
  ended_at timestamptz not null check (ended_at > started_at),

  -- How wide the failure was. 'all' is everything live at the time; the
  -- others narrow it, for a region that lost its CDN or a single surface
  -- that broke.
  scope text not null default 'all'
    check (scope in ('all', 'state', 'lga', 'tier')),
  scope_state text,
  scope_lga text,
  scope_tier text check (scope_tier in ('listed', 'promoted', 'featured')),

  reason text not null,

  -- Filled in once the fan-out has run, so a half-applied outage is
  -- visible rather than silent.
  applied_at timestamptz,
  placements_credited integer not null default 0,
  days_credited integer not null default 0,

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ad_outages_created_idx on public.ad_outages (created_at desc);

-- One row per placement per credit. The audit trail: in six months this
-- is what answers "why does this placement end on the 5th" without
-- anybody having to remember.
create table if not exists public.ad_credits (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.ad_placements(id) on delete cascade,
  outage_id uuid references public.ad_outages(id) on delete set null,

  days integer not null check (days > 0),
  reason text not null,

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ad_credits_placement_idx on public.ad_credits (placement_id, created_at desc);

-- An outage is credited once. Without this a double-tap on the button, or
-- two admins reacting to the same incident, would silently hand out the
-- days twice.
create unique index if not exists ad_credits_once_per_outage_idx
  on public.ad_credits (placement_id, outage_id)
  where outage_id is not null;

alter table public.ad_outages enable row level security;
alter table public.ad_credits enable row level security;
revoke all on public.ad_outages from anon, authenticated;
revoke all on public.ad_credits from anon, authenticated;

-- =====================================================================
-- The fan-out
-- =====================================================================
-- Set-based on purpose. Crediting fifty thousand placements one HTTP
-- round trip at a time would take hours and fail halfway; here it is a
-- single statement inside one transaction, so it either all lands or
-- none of it does.
--
-- Days are rounded UP. A six-hour outage returns a day rather than a
-- quarter of one. Cheap generosity, and it avoids arguing about hours.
create or replace function public.apply_ad_outage(p_outage uuid, p_admin uuid)
returns table (placements integer, days integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  n_placements integer := 0;
  n_days integer := 0;
begin
  select * into o from public.ad_outages where id = p_outage;
  if not found then
    raise exception 'outage not found';
  end if;
  if o.applied_at is not null then
    -- Already done. Report what it did rather than doing it again.
    return query select o.placements_credited, o.days_credited;
    return;
  end if;

  with affected as (
    select
      p.id,
      -- Only the part of the outage that overlaps this placement's own
      -- live period. Somebody who started mid-outage is owed the
      -- remainder, not the whole thing.
      greatest(
        1,
        ceil(
          extract(epoch from (
            least(o.ended_at, coalesce(p.ends_at, o.ended_at))
            - greatest(o.started_at, coalesce(p.starts_at, o.started_at))
          )) / 86400.0
        )::integer
      ) as owed
    from public.ad_placements p
    where p.status in ('live', 'paused')
      -- Live at some point during the window.
      and coalesce(p.starts_at, o.started_at) < o.ended_at
      and coalesce(p.ends_at, o.ended_at) > o.started_at
      and (o.scope <> 'state' or p.state = o.scope_state)
      and (o.scope <> 'lga' or (p.state = o.scope_state and p.lga = o.scope_lga))
      and (o.scope <> 'tier' or p.tier = o.scope_tier)
  ),
  ins as (
    insert into public.ad_credits (placement_id, outage_id, days, reason, created_by)
    select a.id, p_outage, a.owed, o.reason, p_admin from affected a
    on conflict do nothing
    returning placement_id, days
  ),
  upd as (
    update public.ad_placements p
       set ends_at        = coalesce(p.ends_at, now()) + make_interval(days => i.days),
           next_charge_at = case
             when p.next_charge_at is null then null
             else p.next_charge_at + make_interval(days => i.days)
           end,
           updated_at = now()
      from ins i
     where p.id = i.placement_id
    returning p.id
  )
  select count(*)::integer, coalesce(sum(i.days), 0)::integer
    into n_placements, n_days
    from ins i;

  update public.ad_outages
     set applied_at = now(),
         placements_credited = n_placements,
         days_credited = n_days
   where id = p_outage;

  return query select n_placements, n_days;
end;
$$;

revoke all on function public.apply_ad_outage(uuid, uuid) from public, anon, authenticated;
