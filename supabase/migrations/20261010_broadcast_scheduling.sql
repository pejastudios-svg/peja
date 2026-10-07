-- Scheduled broadcasts.
--
-- Most of this calendar is known in advance, and the useful moments are
-- awkward ones: a New Year's Eve safety message wants to land in the early
-- evening, not whenever somebody remembers to open the admin panel. The
-- milestone cron already covers the fixed annual calendar; this covers
-- everything else, written now and sent later.
--
-- A scheduled broadcast is a real row from the moment it is created, so it
-- can be reviewed and cancelled before it goes. Nothing is delivered until
-- the dispatch cron picks it up, flips it to 'sent' and fans it out
-- through exactly the same path as pressing Send.

-- 'scheduled' joins the existing states. The old constraint has to go
-- first: a check constraint cannot be widened in place.
alter table public.broadcasts
  drop constraint if exists broadcasts_status_check;

alter table public.broadcasts
  add constraint broadcasts_status_check
  check (status in ('draft', 'scheduled', 'sent', 'cancelled'));

-- When to send. Null means "send immediately", which is every broadcast
-- created before this migration, so no backfill is needed.
alter table public.broadcasts
  add column if not exists scheduled_for timestamptz;

comment on column public.broadcasts.scheduled_for is
  'When the dispatch cron should send this. Null for broadcasts sent immediately.';

-- The cron asks one question every few minutes: anything scheduled and
-- due? A partial index keeps that a tiny lookup no matter how much history
-- accumulates, since only unsent rows are ever scanned.
create index if not exists broadcasts_due_idx
  on public.broadcasts (scheduled_for)
  where status = 'scheduled';
