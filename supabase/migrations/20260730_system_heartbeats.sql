-- Watchdog support:every background job records that it ran.
--
-- Why this exists: the checkin-monitor cron (missed check-in alerts, SOS
-- escalation) was disabled by the scheduler after repeated failures and
-- nobody found out for ten days. A safety feature that dies quietly is
-- worse than one that was never built, because everyone assumes it is
-- watching. Now a job writes its heartbeat, and an independent job checks
-- that the heartbeat is fresh.

create table if not exists public.system_heartbeats (
  job          text primary key,
  last_run_at  timestamptz not null default now(),
  detail       jsonb
);

-- Service-role only: no client policies on purpose (RLS enabled with no
-- policy denies anon/authenticated entirely).
alter table public.system_heartbeats enable row level security;
