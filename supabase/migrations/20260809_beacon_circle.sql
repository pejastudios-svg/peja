-- Beacon Circle: one account hosts many Beacons.
--
-- A mother with three children pairs three devices under her account; a
-- school pairs a thousand. Nothing at the database level ever limited an
-- account to one device (only the UI did), so this migration is additive:
-- wearer identity on the device, and an explicit per-device viewer grant
-- for the people who may see it.
--
-- THE privacy rule (the school case lives or dies on it): a hosted Beacon
-- is visible to its host and its GRANTED viewers only. The existing
-- share-with-contacts path stays for the family case (owner's emergency
-- contacts see the Beacon unless individually hidden), and grants extend
-- visibility to people who are NOT the host's contacts, one device at a
-- time. A parent granted their child's Beacon sees that one Beacon,
-- never the other 999.

-- 1. Who wears this device. Kept separate from `name` (the device model
--    label) because a fleet is navigated by wearer, not by hardware.
alter table public.devices
  add column if not exists wearer_name  text,
  add column if not exists wearer_color text;

-- 2. Explicit viewer grants.
create table if not exists public.beacon_viewers (
  device_id       uuid not null references public.devices(id) on delete cascade,
  viewer_user_id  uuid not null references public.users(id) on delete cascade,
  granted_by      uuid not null references public.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (device_id, viewer_user_id)
);

alter table public.beacon_viewers enable row level security;

-- Host manages the grants for their devices.
drop policy if exists "host manages beacon viewers" on public.beacon_viewers;
create policy "host manages beacon viewers"
  on public.beacon_viewers for all
  to authenticated
  using (exists (
    select 1 from public.devices d
    where d.id = beacon_viewers.device_id and d.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.devices d
    where d.id = beacon_viewers.device_id and d.user_id = auth.uid()
  ));

-- A viewer can see (and delete, i.e. leave) their own grant.
drop policy if exists "viewer reads own grants" on public.beacon_viewers;
create policy "viewer reads own grants"
  on public.beacon_viewers for select
  to authenticated
  using (viewer_user_id = auth.uid());

drop policy if exists "viewer leaves" on public.beacon_viewers;
create policy "viewer leaves"
  on public.beacon_viewers for delete
  to authenticated
  using (viewer_user_id = auth.uid());

-- SECURITY DEFINER helper, same pattern as beacon_hidden_from: lets the
-- devices policy consult grants without giving readers the table.
create or replace function public.beacon_granted_to(p_device uuid, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.beacon_viewers
    where device_id = p_device and viewer_user_id = p_user
  );
$$;

-- Granted viewers read the device row (positions, battery, status).
drop policy if exists "granted viewers read devices" on public.devices;
create policy "granted viewers read devices"
  on public.devices for select
  to authenticated
  using (
    status <> 'unpaired'
    and public.beacon_granted_to(devices.id, auth.uid())
  );

-- 3. Invites for viewers who are not on peja yet (the school hands out
--    devices before parents have the app). The row id doubles as the
--    invite token: knowing it is the capability to claim, so rows are
--    never client-readable except through the host policy.
create table if not exists public.beacon_invites (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references public.devices(id) on delete cascade,
  created_by     uuid not null references public.users(id) on delete cascade,
  invitee_label  text,                    -- "Ada's dad", shown to the host
  status         text not null default 'pending'
                 check (status in ('pending', 'claimed', 'revoked')),
  claimed_by     uuid references public.users(id) on delete set null,
  claimed_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists beacon_invites_device_idx on public.beacon_invites (device_id);

alter table public.beacon_invites enable row level security;

-- Host manages their invites. Claiming happens through a service-role
-- route (the token itself is the authorization), so no other policy.
drop policy if exists "host manages beacon invites" on public.beacon_invites;
create policy "host manages beacon invites"
  on public.beacon_invites for all
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- 4. Grants should also open up the wearer's places to the viewer
--    (phase 3 renders them). Uses the same definer helper.
drop policy if exists "granted viewers read device places" on public.places;
create policy "granted viewers read device places"
  on public.places for select
  to authenticated
  using (
    visible_to_circle
    and device_id is not null
    and public.beacon_granted_to(places.device_id, auth.uid())
  );
