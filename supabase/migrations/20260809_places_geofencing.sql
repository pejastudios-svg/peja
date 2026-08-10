-- Phase 1 of geofencing: saved places and arrival/departure state.
--
-- A place belongs to an account. device_id stays null in this phase; when
-- the Beacon Circle work lands (next migration) a place can belong to one
-- of the account's hosted Beacons instead ("Ada's school"), and the same
-- evaluator serves both.
--
-- Geofence evaluation happens SERVER SIDE in the position-ingest routes,
-- never on the phone: positions already flow to the server during any
-- active share (including from the native Android service with the app
-- closed), so arrival detection keeps working when the app is swiped away.

create table if not exists public.places (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null references public.users(id) on delete cascade,
  device_id         uuid references public.devices(id) on delete cascade,
  label             text not null check (char_length(label) between 1 and 60),
  kind              text not null default 'custom'
                    check (kind in ('home', 'school', 'work', 'lesson', 'custom')),
  lat               double precision not null check (lat between -90 and 90),
  lng               double precision not null check (lng between -180 and 180),
  radius_m          integer not null default 150 check (radius_m between 100 and 500),
  address_text      text,
  -- People who can already see this subject's location may also see the
  -- place marker. Off = the place exists only for the owner's own eyes
  -- and for arrival wording.
  visible_to_circle boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists places_owner_idx on public.places (owner_user_id);
create index if not exists places_device_idx on public.places (device_id);

-- Server-side memory of who is currently inside which fence. One row per
-- subject+place; the evaluator flips `inside` with hysteresis and stamps
-- last_event_at to rate-limit repeat notifications.
--
-- subject_key: "user:<uuid>" for a phone, "device:<uuid>" for a Beacon.
-- Text key rather than two nullable FKs so the unique constraint stays
-- simple and the evaluator code identical for both subjects.
--
-- Hysteresis is TIME based (pending_since), not fix-counting, because the
-- same position can be evaluated twice: once by the ingest route and once
-- by the checkin-monitor cron (native Android writes positions straight to
-- Supabase and bypasses our routes, so the cron is the net that catches
-- those). Re-evaluating the same evidence twice must not accelerate a
-- transition; with a dwell clock it cannot.
create table if not exists public.geofence_state (
  subject_key   text not null,
  place_id      uuid not null references public.places(id) on delete cascade,
  inside        boolean not null default false,
  since         timestamptz not null default now(),
  -- When contrary evidence started (outside evidence while inside, or the
  -- reverse). Enter flips after 45s of it, exit after 90s beyond radius
  -- plus a 100m buffer. Null = current state unchallenged.
  pending_since timestamptz,
  last_event_at timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (subject_key, place_id)
);

alter table public.places enable row level security;
alter table public.geofence_state enable row level security;

-- Owner manages their own places (and, later, their Beacons' places:
-- device places are still owned by owner_user_id, so this policy already
-- covers them).
drop policy if exists "owner manages places" on public.places;
create policy "owner manages places"
  on public.places for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Accepted emergency contacts may READ a circle-visible place. Place
-- visibility must never be wider than the subject's location sharing;
-- for phase 1 the subject is the owner, and the audience that can see
-- the owner's live location during a check-in is their accepted
-- contacts, so that is the ceiling used here.
drop policy if exists "contacts read circle places" on public.places;
create policy "contacts read circle places"
  on public.places for select
  to authenticated
  using (
    visible_to_circle
    and device_id is null
    and exists (
      select 1
      from public.emergency_contacts ec
      where ec.user_id = places.owner_user_id
        and ec.contact_user_id = auth.uid()
        and ec.status = 'accepted'
    )
  );

-- geofence_state is server bookkeeping. No client policies at all: only
-- the service role touches it.

-- Destination on a check-in. Snapshotted (label + coords + radius) rather
-- than only referenced, so deleting a saved place mid-journey does not
-- break the active session; place_id is kept for "recent destinations".
alter table public.safety_checkins
  add column if not exists destination_place_id uuid references public.places(id) on delete set null,
  add column if not exists destination_label    text,
  add column if not exists destination_lat      double precision,
  add column if not exists destination_lng      double precision,
  add column if not exists destination_radius_m integer,
  -- Dwell clock for the destination fence (same role as
  -- geofence_state.pending_since, kept on the session because a pin-drop
  -- destination has no places row to hang state on).
  add column if not exists destination_pending_since timestamptz,
  -- Arrival is one shot per session: set once, never cleared.
  add column if not exists arrived_at           timestamptz;
