-- Always-on ambient tracker: per-device long-lived credentials.
--
-- The native Android service outlives the app process, so it cannot use
-- the session access token (expires ~1h). Instead the app mints ONE
-- device key per user (shown once, stored hashed here + in native
-- prefs); the service authenticates location beats with it against
-- /api/presence/beat. Revoked on toggle-off or logout.

create table if not exists public.device_tracking_keys (
  user_id      uuid primary key references public.users(id) on delete cascade,
  secret_hash  text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists device_tracking_keys_hash_idx
  on public.device_tracking_keys (secret_hash);

-- Service-role only: no client policies on purpose. Enabling RLS with no
-- policies denies anon/authenticated entirely; API routes use the admin
-- client.
alter table public.device_tracking_keys enable row level security;
