-- Election Watch: photographed result sheets, MVP tallying, public counts.
--
-- Trust model, in one paragraph: VIPs and MVPs photograph official result
-- sheets at polling units and upload them tagged to a state + LGA. MVPs
-- read the sheets and enter per-candidate figures. Every peja user can
-- browse state -> LGA and see the photos NEXT TO the numbers, so the
-- arithmetic is checkable by anyone. Evidence is append-only: uploads can
-- never be edited or deleted by anyone, the admin can only HIDE one from
-- public view with a stated reason, and the record survives.
--
-- Writes go exclusively through service-role API routes (PIN-gated).
-- Clients get read-only RLS. There is deliberately NO update or delete
-- policy on any of these tables, for anyone.

create table if not exists public.elections (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 3 and 120),
  description text,
  cover_url   text,
  created_by  uuid not null references public.users(id),
  status      text not null default 'active' check (status in ('active', 'closed')),
  created_at  timestamptz not null default now()
);

create table if not exists public.election_candidates (
  id          uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 120),
  description text,
  photo_url   text,
  created_by  uuid not null references public.users(id),
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists election_candidates_election_idx
  on public.election_candidates (election_id, sort);

-- One photographed result sheet. Append-only forever.
create table if not exists public.election_uploads (
  id            uuid primary key default gen_random_uuid(),
  election_id   uuid not null references public.elections(id) on delete cascade,
  uploader_id   uuid not null references public.users(id),
  state         text not null,
  lga           text not null,
  polling_unit  text,                     -- free text, optional
  photo_url     text not null,
  -- SHA-256 of the exact bytes uploaded. Even if storage were somehow
  -- tampered with, the ledger says what the original looked like.
  photo_sha256  text not null,
  -- Where the UPLOADING PHONE actually was, straight from its GPS at the
  -- moment of upload (null if it refused). Sits next to the CLAIMED
  -- state/LGA so a sheet "from Kano" uploaded from Lagos is visible.
  device_lat    double precision,
  device_lng    double precision,
  device_accuracy_m real,
  -- Moderation: hidden from public browse, never removed. The reason is
  -- shown publicly in place of the photo.
  hidden        boolean not null default false,
  hidden_reason text,
  hidden_by     uuid references public.users(id),
  hidden_at     timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists election_uploads_scope_idx
  on public.election_uploads (election_id, state, lga);
create index if not exists election_uploads_uploader_idx
  on public.election_uploads (uploader_id);

-- One MVP's reading of one sheet: {candidate_id: votes}. Append-only.
-- A correction is a NEW row that supersedes the old one; the old row
-- stays, publicly visible in the sheet's history. Latest (superseded_by
-- is null) is what counts toward totals.
create table if not exists public.election_tallies (
  id            uuid primary key default gen_random_uuid(),
  upload_id     uuid not null references public.election_uploads(id) on delete cascade,
  election_id   uuid not null references public.elections(id) on delete cascade,
  tallied_by    uuid not null references public.users(id),
  figures       jsonb not null,
  note          text,
  superseded_by uuid references public.election_tallies(id),
  created_at    timestamptz not null default now()
);

create index if not exists election_tallies_upload_idx
  on public.election_tallies (upload_id);
create index if not exists election_tallies_live_idx
  on public.election_tallies (election_id)
  where superseded_by is null;

-- Per-user election security: the action PIN and the freeze switch.
-- The PIN is scrypt-hashed; five failures locks the account's election
-- actions until the admin unlocks. Freeze is the admin kill switch for a
-- compromised account. No client policies AT ALL on this table.
create table if not exists public.election_access (
  user_id         uuid primary key references public.users(id) on delete cascade,
  pin_hash        text not null,
  pin_salt        text not null,
  failed_attempts integer not null default 0,
  locked_at       timestamptz,
  frozen          boolean not null default false,
  updated_at      timestamptz not null default now()
);

-- Admin actions ledger (hide, freeze, unlock...). Uploads and tallies are
-- their own ledger; this covers the moderation side.
create table if not exists public.election_audit (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid not null references public.users(id),
  action     text not null,
  subject    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ── RLS: everyone signed in can READ; nobody can write from a client ──
alter table public.elections enable row level security;
alter table public.election_candidates enable row level security;
alter table public.election_uploads enable row level security;
alter table public.election_tallies enable row level security;
alter table public.election_access enable row level security;
alter table public.election_audit enable row level security;

drop policy if exists "read elections" on public.elections;
create policy "read elections" on public.elections
  for select to authenticated using (true);

drop policy if exists "read candidates" on public.election_candidates;
create policy "read candidates" on public.election_candidates
  for select to authenticated using (true);

drop policy if exists "read uploads" on public.election_uploads;
create policy "read uploads" on public.election_uploads
  for select to authenticated using (true);

drop policy if exists "read tallies" on public.election_tallies;
create policy "read tallies" on public.election_tallies
  for select to authenticated using (true);

-- election_access and election_audit: service role only, no policies.

-- ── Storage: the evidence prefix is immutable for everyone but the
--    service role. RESTRICTIVE policies bite even if some permissive
--    policy on the media bucket would otherwise allow the action. ──
drop policy if exists "elections evidence no client update" on storage.objects;
create policy "elections evidence no client update" on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'media' or name not like 'elections/%');

drop policy if exists "elections evidence no client delete" on storage.objects;
create policy "elections evidence no client delete" on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'media' or name not like 'elections/%');

drop policy if exists "elections evidence no client insert" on storage.objects;
create policy "elections evidence no client insert" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'media' or name not like 'elections/%');
