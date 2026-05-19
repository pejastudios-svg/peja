-- Moderation context for user suspensions, bans, and deletions. Until now,
-- the only signal admins had after taking action was the `users.status`
-- enum — no record of WHY a user was suspended, WHEN it was supposed to
-- end, or WHO made the call. This migration adds:
--
-- 1. Reason + audit timestamp columns on users for suspensions and bans.
-- 2. An optional suspended_until cutoff for timed suspensions. NULL means
--    indefinite (admin must lift manually). Anything in the past should be
--    treated as expired — the AuthContext clears status back to active.
-- 3. A user_deletion_log table so admin-initiated deletions leave an
--    auditable trail even though the user row itself is hard-deleted.

alter table public.users
  add column if not exists suspension_reason text,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_until timestamptz,
  add column if not exists suspended_by uuid references auth.users(id) on delete set null,
  add column if not exists ban_reason text,
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by uuid references auth.users(id) on delete set null;

-- Quickly find users whose timed suspension has expired so a scheduled
-- job (or the AuthContext on next session) can lift them efficiently.
create index if not exists idx_users_suspended_until
  on public.users(suspended_until)
  where suspended_until is not null;

-- Audit trail for hard deletions. The user row itself is gone but this
-- record sticks around so support can answer "why was X's account
-- removed?" weeks later.
create table if not exists public.user_deletion_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_email text,
  user_full_name text,
  deleted_by uuid references auth.users(id) on delete set null,
  deletion_reason text,
  initiated_by text not null check (initiated_by in ('user', 'admin')),
  deleted_at timestamptz not null default now()
);

create index if not exists idx_user_deletion_log_user_id
  on public.user_deletion_log(user_id);
create index if not exists idx_user_deletion_log_deleted_at
  on public.user_deletion_log(deleted_at desc);

-- RLS: only admins should read this. The service role used by the API
-- bypasses RLS, so no policies needed for inserts from the delete-user
-- API route. Reads from the admin dashboard go through requireAdmin.
alter table public.user_deletion_log enable row level security;
