-- Share a Beacon's position with the owner's emergency contacts, not just
-- during an SOS.
--
-- Until now a Beacon pin was owner-only (design D5), so a family could
-- only see grandma's tracker while an alarm was active. That is backwards
-- for the people the device exists to reassure: the everyday glance is
-- the point, and the emergency is the exception.
--
-- Consent model mirrors the app's own location sharing:
--   - ON by default, because someone who pairs a Beacon for a relative is
--     doing it precisely so their people can see it.
--   - The owner can switch it off at any time, and then nobody but them
--     sees it (SOS alerts still reach contacts, since an emergency is not
--     a privacy preference).
--   - "Contacts" means ACCEPTED emergency contacts only.

alter table public.devices
  add column if not exists share_with_contacts boolean not null default true;

-- Contacts may read a shared device. Kept as a separate policy so the
-- existing owner-only policy stays untouched: PostgreSQL ORs permissive
-- policies together.
drop policy if exists "contacts read shared devices" on public.devices;
create policy "contacts read shared devices"
  on public.devices for select
  to authenticated
  using (
    share_with_contacts
    and status <> 'unpaired'
    and exists (
      select 1
      from public.emergency_contacts ec
      where ec.user_id = devices.user_id
        and ec.contact_user_id = auth.uid()
        and ec.status = 'accepted'
        -- Respect the owner hiding from a specific person, exactly as the
        -- app's presence sharing does.
        and ec.hide_from_contact = false
    )
  );

-- Contacts land here by user_id; keep that lookup cheap.
create index if not exists devices_user_shared_idx
  on public.devices (user_id)
  where share_with_contacts and status <> 'unpaired';
