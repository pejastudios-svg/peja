-- Beacon 1 (P02L tracker) device pairing + telemetry.
-- See P02L_DEVICE_INTEGRATION.md at repo root for the full design.
--
-- RLS model (house style):
--   • Users can SELECT their own devices/events.
--   • All writes go through service-role code (pairing API + the TCP
--     device gateway), which bypasses RLS entirely.

create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  device_id     text not null unique,     -- ID printed on the back / QR (tel:<device_id>); appears in 808 header
  imei          text,
  sim_msisdn    text not null,            -- phone number of the SIM inside the device (E.164). Treat as secret.
  iccid         text,                     -- reported by device via 0x0120
  name          text not null default 'Beacon 1',
  status        text not null default 'pairing'
                check (status in ('pairing','configuring','connected','offline','unpaired')),
  family1_contact_id uuid references public.emergency_contacts(id) on delete set null,
  family2_contact_id uuid references public.emergency_contacts(id) on delete set null,
  sos_msisdn    text,                     -- number pushed as the device SOS call/SMS target (contact 1's phone)
  volume        smallint not null default 1 check (volume between 0 and 4),
  work_mode     smallint not null default 3 check (work_mode between 0 and 3),
  fall_alert_enabled boolean not null default false,  -- user opt-in; fall alerts go to contacts only
  sos_ack_tone  boolean not null default true,        -- quiet tone via 0x8300 when platform receives SOS
  intercom_enabled boolean not null default false,    -- decided: off at pairing until HK latency validated
  intercom_group text,                    -- group name served to the device via 0x8304
  battery_pct   smallint,
  last_lat      double precision,
  last_lng      double precision,
  last_fix_at   timestamptz,
  last_seen_at  timestamptz,              -- any TCP frame from the device
  firmware      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists devices_user_id_idx on public.devices (user_id);

create table if not exists public.device_events (
  id           bigint generated always as identity primary key,
  device_id    uuid not null references public.devices(id) on delete cascade,
  type         text not null
               check (type in ('location','sos','fall','low_battery','heartbeat',
                               'connect','disconnect','config_ack','register')),
  lat          double precision,
  lng          double precision,
  battery_pct  smallint,
  raw          jsonb,                     -- decoded frame, for debugging
  sos_alert_id uuid references public.sos_alerts(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists device_events_device_created_idx
  on public.device_events (device_id, created_at desc);

alter table public.devices enable row level security;
alter table public.device_events enable row level security;

drop policy if exists "users read own devices" on public.devices;
create policy "users read own devices"
  on public.devices for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users read own device events" on public.device_events;
create policy "users read own device events"
  on public.device_events for select
  to authenticated
  using (exists (
    select 1 from public.devices d
    where d.id = device_events.device_id and d.user_id = auth.uid()
  ));

comment on table public.devices is
  'Paired Beacon 1 (P02L) trackers. Configured over SMS, tracked over TCP gateway.';
comment on table public.device_events is
  'Telemetry + alarm stream from Beacon 1 devices, written by the device gateway.';
