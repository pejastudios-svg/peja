-- Map-first home, phase 2 foundation: ambient presence.
-- See PEJA_MAP_HOME_DESIGN.md. Foreground-only capture (no background
-- tracking): one row per user, upserted while the app is open.
--
-- Visibility model (D1/D3, resolved 2026-07-13):
--   contact row = (owner user_id, protector contact_user_id, accepted)
--   - protector sees owner by default; owner hides via hide_from_contact
--   - owner sees protector only if protector set share_back
--     (asked at accept, pre-checked); protector pauses by unsetting it

create table if not exists public.presence (
  user_id     uuid primary key references public.users(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  real,
  battery_pct smallint,
  captured_at timestamptz not null default now()
);

alter table public.emergency_contacts
  add column if not exists share_back boolean not null default false,
  add column if not exists hide_from_contact boolean not null default false;

alter table public.presence enable row level security;

-- Own row: full control.
drop policy if exists "own presence write" on public.presence;
create policy "own presence write"
  on public.presence for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Read: yourself, people you protect (unless they paused you), and
-- protectors who shared back with you.
drop policy if exists "circle presence read" on public.presence;
create policy "circle presence read"
  on public.presence for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.emergency_contacts ec
      where ec.user_id = presence.user_id
        and ec.contact_user_id = auth.uid()
        and ec.status = 'accepted'
        and ec.hide_from_contact = false
    )
    or exists (
      select 1 from public.emergency_contacts ec
      where ec.user_id = auth.uid()
        and ec.contact_user_id = presence.user_id
        and ec.status = 'accepted'
        and ec.share_back = true
    )
  );

comment on table public.presence is
  'Last-known ambient location per user, foreground-captured. Powers the map-first home. Visibility via emergency_contacts grants.';
