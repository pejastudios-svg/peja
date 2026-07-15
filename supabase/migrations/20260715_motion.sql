-- Motion layer for the live map (speed + heading + stillness).
--
-- presence: written by the sharer's device while the map is open
--   (MapHome live writer, 10s cadence while moving / 60s while still).
--   speed_kmh   null = unknown (ambient capture can't know speed)
--   heading     degrees clockwise from north, null = unknown
--   still_since set when the device has not meaningfully moved; viewers
--               show "Still for Xm" once it's older than 60s
--
-- safety_checkins: same idea for active SML sessions; the web tracker
--   sends speed with each location update. still_since is computed by
--   /api/checkin/location by comparing successive coordinates (native
--   Android updates PATCH the table directly and skip that computation;
--   speed for those sessions stays null until the service is updated).

alter table public.presence
  add column if not exists speed_kmh   real,
  add column if not exists heading     real,
  add column if not exists still_since timestamptz;

alter table public.safety_checkins
  add column if not exists speed_kmh   real,
  add column if not exists still_since timestamptz;
