-- Advertising on peja.
--
-- Businesses buy a place on a safety map. That framing drives most of the
-- decisions here, and the ones that are not obvious are noted where they
-- are made rather than in one block at the top.
--
-- Three tiers: a map pin (Listed), pin plus sponsored search (Promoted),
-- and those plus the search carousel (Featured).

create extension if not exists "pgcrypto";

-- =====================================================================
-- The business
-- =====================================================================
create table if not exists public.advertisers (
  id uuid primary key default gen_random_uuid(),

  -- The peja account that manages this business. Advertisers sign in with
  -- an ordinary account rather than a separate login, so the dashboard,
  -- the notifications and the billing all hang off something that already
  -- exists.
  owner_user_id uuid not null references public.users(id) on delete cascade,

  business_name text not null,
  category text not null,
  -- One line. Shown under the name in search and in the tap modal.
  tagline text,

  logo_url text,
  -- {"instagram":"...","whatsapp":"...","website":"...", ...}
  socials jsonb not null default '{}'::jsonb,

  contact_email text,
  contact_phone text,

  -- An online-only business has no pin. It can still buy search and the
  -- carousel, scoped to the LGAs it names.
  is_online_only boolean not null default false,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'suspended')),
  rejection_reason text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advertisers_owner_idx on public.advertisers (owner_user_id);
create index if not exists advertisers_pending_idx on public.advertisers (created_at desc)
  where status = 'pending';

-- =====================================================================
-- A bought placement
-- =====================================================================
create table if not exists public.ad_placements (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers(id) on delete cascade,

  tier text not null check (tier in ('listed', 'promoted', 'featured')),

  -- Where it sits. lat/lng drive the map pin and the distance shown in
  -- search; state/lga are the bucket that caps and scopes everything,
  -- because overlapping radii cannot answer "how many are sold here".
  lat double precision,
  lng double precision,
  state text,
  lga text,
  -- shop / cafe / school / office / clinic / ... Chosen by the advertiser,
  -- drawn as ordinary map furniture so ads read as landmarks rather than
  -- adverts.
  building_type text,

  -- Featured only. peja renders the banner from these; nothing is
  -- uploaded, so an advertiser with no designer is not shut out of the
  -- most expensive tier and the carousel stays visually consistent.
  banner_text text,
  banner_gradient text,

  status text not null default 'pending' check (
    status in ('pending', 'approved', 'live', 'paused', 'expired', 'rejected', 'cancelled')
  ),
  rejection_reason text,

  price_naira integer not null,
  auto_renew boolean not null default true,

  starts_at timestamptz,
  ends_at timestamptz,

  -- Billing and dunning. hidden_at is set on day 4 of a failed payment:
  -- the ad stops showing but the slot stays reserved until day 7, or
  -- until someone is waiting for it.
  next_charge_at timestamptz,
  last_paid_at timestamptz,
  failed_attempts integer not null default 0,
  hidden_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_placements_advertiser_idx on public.ad_placements (advertiser_id);
create index if not exists ad_placements_review_idx on public.ad_placements (created_at desc)
  where status = 'pending';

-- The serving query: live placements in a bucket, by tier. Partial so the
-- index stays small as cancelled and expired rows pile up.
create index if not exists ad_placements_serving_idx
  on public.ad_placements (state, lga, tier)
  where status = 'live';

-- Map pins are fetched by bounding box, so the hot path is lat/lng.
create index if not exists ad_placements_geo_idx
  on public.ad_placements (lat, lng)
  where status = 'live';

create index if not exists ad_placements_due_idx
  on public.ad_placements (next_charge_at)
  where status = 'live' and auto_renew;

-- =====================================================================
-- Metrics
-- =====================================================================
-- Daily counters, not raw events. One row per placement per day instead
-- of one per impression: at a million users a raw event table would be
-- the largest thing in the database within a week, and the dashboard only
-- ever shows totals over time anyway.
create table if not exists public.ad_daily_stats (
  placement_id uuid not null references public.ad_placements(id) on delete cascade,
  day date not null,
  impressions integer not null default 0,
  taps integer not null default 0,
  social_clicks integer not null default 0,
  direction_taps integer not null default 0,
  primary key (placement_id, day)
);

create index if not exists ad_daily_stats_day_idx on public.ad_daily_stats (day desc);

-- =====================================================================
-- Waitlist
-- =====================================================================
-- When an LGA is sold out at a tier, the next buyer queues with a 25%
-- deposit. The deposit is refundable at any point before the balance is
-- taken: they are waiting, they have had nothing, so there is nothing to
-- argue about.
create table if not exists public.ad_queue (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers(id) on delete cascade,
  state text not null,
  lga text not null,
  tier text not null check (tier in ('listed', 'promoted', 'featured')),

  deposit_naira integer not null,
  deposit_paid_at timestamptz,

  status text not null default 'waiting'
    check (status in ('waiting', 'offered', 'converted', 'cancelled', 'expired')),

  -- A slot opened and the balance is due. They get 24 hours' notice
  -- before the card is charged, and can cancel for a full refund in that
  -- window. If the charge fails the window extends 24 hours at a time,
  -- for up to 7 days, but only while nobody else is queuing for the same
  -- slot.
  offered_at timestamptz,
  offer_expires_at timestamptz,
  extensions integer not null default 0,

  created_at timestamptz not null default now()
);

-- Position in the queue is created_at order within a bucket.
create index if not exists ad_queue_bucket_idx
  on public.ad_queue (state, lga, tier, created_at)
  where status = 'waiting';

-- =====================================================================
-- How many can be sold in one place
-- =====================================================================
-- Scarcity is the product. Two pins on screen is what keeps the map from
-- looking sold, and a capped carousel is the only reason Featured is
-- worth what it costs: sell the five thousandth Featured slot and
-- Featured is worth nothing to anybody.
--
-- Defaults live in code; a row here overrides one bucket, for a Lekki or
-- a Victoria Island that can carry more.
create table if not exists public.ad_area_caps (
  state text not null,
  lga text not null,
  tier text not null check (tier in ('listed', 'promoted', 'featured')),
  max_slots integer not null check (max_slots >= 0),
  primary key (state, lga, tier)
);

-- =====================================================================
-- Access
-- =====================================================================
-- Everything reaches these tables through service-role API routes, which
-- bypass RLS. Enabled with no policies so nothing is readable or writable
-- directly with an anon key.
alter table public.advertisers enable row level security;
alter table public.ad_placements enable row level security;
alter table public.ad_daily_stats enable row level security;
alter table public.ad_queue enable row level security;
alter table public.ad_area_caps enable row level security;

revoke all on public.advertisers from anon, authenticated;
revoke all on public.ad_placements from anon, authenticated;
revoke all on public.ad_daily_stats from anon, authenticated;
revoke all on public.ad_queue from anon, authenticated;
revoke all on public.ad_area_caps from anon, authenticated;

-- Counter bump. One statement, no read-modify-write, so concurrent
-- impressions from different devices cannot lose each other.
create or replace function public.bump_ad_stat(
  p_placement uuid,
  p_kind text,
  p_count integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ad_daily_stats (placement_id, day, impressions, taps, social_clicks, direction_taps)
  values (
    p_placement, current_date,
    case when p_kind = 'impression' then p_count else 0 end,
    case when p_kind = 'tap' then p_count else 0 end,
    case when p_kind = 'social' then p_count else 0 end,
    case when p_kind = 'directions' then p_count else 0 end
  )
  on conflict (placement_id, day) do update set
    impressions    = public.ad_daily_stats.impressions    + excluded.impressions,
    taps           = public.ad_daily_stats.taps           + excluded.taps,
    social_clicks  = public.ad_daily_stats.social_clicks  + excluded.social_clicks,
    direction_taps = public.ad_daily_stats.direction_taps + excluded.direction_taps;
end;
$$;

revoke all on function public.bump_ad_stat(uuid, text, integer) from public, anon, authenticated;
