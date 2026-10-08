-- One-time unlock for the Beacon section.
--
-- The Beacon area is held behind a code while the hardware is still in
-- limited release. Two decisions matter here:
--
-- 1. The code is verified SERVER side, against a scrypt hash in
--    BEACON_UNLOCK_HASH, never in the bundle. A six-digit code checked in
--    the browser is a million guesses, which is milliseconds of work, so
--    shipping either the code or its hash to the client would be the same
--    as shipping nothing.
--
-- 2. The unlocked state lives HERE rather than in localStorage. A flag in
--    browser storage is one devtools line away from being set by hand, and
--    it would also mean re-entering the code on every new device. A column
--    is neither.
alter table public.users
  add column if not exists beacon_unlocked_at timestamptz;

comment on column public.users.beacon_unlocked_at is
  'When this account entered the Beacon unlock code. Null means still locked.';

-- Partial: almost every row is null and never needs scanning.
create index if not exists users_beacon_unlocked_idx
  on public.users (id)
  where beacon_unlocked_at is not null;
