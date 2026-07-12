-- Beacon 1: track the device's currently-active SOS alert so
--   1. location reports keep moving the SAME map pin (no pin trail),
--   2. repeat alarms (fall during SOS, fall after fall) refresh the
--      existing alert instead of stacking new ones,
--   3. the owner can cancel it from the Beacon dashboard.

alter table public.devices
  add column if not exists active_sos_alert_id uuid
    references public.sos_alerts(id) on delete set null;
