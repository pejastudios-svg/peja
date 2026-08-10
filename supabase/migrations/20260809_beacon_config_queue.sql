-- Over-the-air config queue for Beacon fleets.
--
-- One row per device being provisioned; the command list rides in jsonb
-- and next_index tracks progress. The checkin-monitor cron drains a few
-- commands per pass, which keeps bulk onboarding inside the Termii rate
-- budget instead of blasting a thousand texts in one request. The same
-- queue is the retry path when a single device's interactive setup fails.

create table if not exists public.beacon_config_jobs (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.devices(id) on delete cascade,
  created_by   uuid not null references public.users(id) on delete cascade,
  commands     jsonb not null,           -- [{label, sms}], device grammar only
  next_index   integer not null default 0,
  status       text not null default 'queued'
               check (status in ('queued', 'sending', 'done', 'failed')),
  attempts     integer not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists beacon_config_jobs_pending_idx
  on public.beacon_config_jobs (created_at)
  where status in ('queued', 'sending');

alter table public.beacon_config_jobs enable row level security;

-- The host can watch their own jobs (progress UI). Writes go through
-- service-role routes only.
drop policy if exists "host reads own config jobs" on public.beacon_config_jobs;
create policy "host reads own config jobs"
  on public.beacon_config_jobs for select
  to authenticated
  using (created_by = auth.uid());
