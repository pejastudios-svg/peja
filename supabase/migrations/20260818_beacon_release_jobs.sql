-- Beacon config jobs need to distinguish configuring a device from
-- releasing one.
--
-- The drain refuses to send to an unpaired device, which is right for
-- provisioning: a released Beacon should not keep receiving settings.
-- But the texts that hand the device back to the vendor platform are the
-- one thing that MUST reach a device we have just unpaired. Without this
-- the release job is marked failed the moment it is picked up, the
-- Beacon never leaves our gateway, and its next heartbeat flips the row
-- back to connected, undoing the unpair.

alter table public.beacon_config_jobs
  add column if not exists kind text not null default 'config'
    check (kind in ('config', 'release'));

comment on column public.beacon_config_jobs.kind is
  'config = provisioning, skipped once a device is unpaired. release = hand-back texts, which must still send to an unpaired device.';
