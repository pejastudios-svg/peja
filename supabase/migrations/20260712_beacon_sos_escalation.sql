-- Beacon 1 SOS escalation: when a device SOS stays active for hours with
-- no movement and no all-clear, contacts get pinged once more. This
-- column remembers that the re-ping happened so it never repeats.

alter table public.devices
  add column if not exists sos_escalated_at timestamptz;
