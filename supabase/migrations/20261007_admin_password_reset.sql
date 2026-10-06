-- Admin-assisted password reset.
--
-- Why this exists: password reset no longer sends a code to the account's
-- own device, because a code on the lock screen of a phone someone else is
-- holding proves nothing. What is left is a recovery code the user saved
-- elsewhere, or two trusted contacts vouching for them.
--
-- Anyone who has neither, and is already locked out, has no route at all.
-- The mandatory setup step in the welcome flow fixes this for new accounts
-- and the recurring prompt catches people who are still signed in, but
-- neither can reach someone who is already shut out. This is that person's
-- only door, and it is opened by a human.

-- Set when an admin issues a temporary password. The app refuses to go any
-- further until the user replaces it, so the temporary password cannot
-- quietly become their permanent one while sitting in their inbox.
alter table public.users
  add column if not exists must_change_password boolean not null default false;

-- Audit trail in its own right, separate from admin_access_log, because
-- this answers a different question: not "did an admin do a thing" but
-- "when was this account last reset, and is someone asking repeatedly".
alter table public.users
  add column if not exists password_reset_by_admin_at timestamptz;

-- Partial: the overwhelming majority of rows are false and never need to
-- be scanned. Only the gate's lookup for a flagged account matters.
create index if not exists users_must_change_password_idx
  on public.users (id)
  where must_change_password;

comment on column public.users.must_change_password is
  'Admin issued a temporary password. The app blocks on a forced change until cleared.';
comment on column public.users.password_reset_by_admin_at is
  'When an admin last issued a temporary password for this account.';
