-- Saved home address. Used as part of the "complete profile" gate that unlocks
-- posting, commenting, and the Guardian application. Surfaced to admins on the
-- user detail page so support can verify identity / locate context for an
-- incident.
--
-- Stored as plain text — geocoding can be added later by populating
-- home_latitude / home_longitude columns if/when proximity-based personalised
-- alerts become a feature.

alter table public.users
  add column if not exists home_address text;
