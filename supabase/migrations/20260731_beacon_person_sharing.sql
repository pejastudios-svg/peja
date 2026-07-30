-- Per-person control over who sees a Beacon.
--
-- Model: an EXCLUSION list. No row means visible, so a contact added
-- later inherits the default-on behaviour without the owner having to
-- remember to grant them anything.
--
-- This also DECOUPLES the Beacon from the owner's own presence sharing.
-- Before, hiding your phone location from someone also hid the Beacon,
-- which is wrong once the Beacon is a device you bought for a relative:
-- you might want your siblings to see your mother's tracker while your
-- own movements stay private from them.

create table if not exists public.device_hidden_contacts (
  device_id        uuid not null references public.devices(id) on delete cascade,
  contact_user_id  uuid not null references public.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (device_id, contact_user_id)
);

alter table public.device_hidden_contacts enable row level security;

-- Only the device owner manages the list.
drop policy if exists "owner manages beacon hiding" on public.device_hidden_contacts;
create policy "owner manages beacon hiding"
  on public.device_hidden_contacts for all
  to authenticated
  using (exists (
    select 1 from public.devices d
    where d.id = device_hidden_contacts.device_id and d.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.devices d
    where d.id = device_hidden_contacts.device_id and d.user_id = auth.uid()
  ));

-- SECURITY DEFINER so the devices policy can consult the list without the
-- READER needing permission to read it (they must not: the exclusion list
-- is the owner's business). Same pattern as the contact-group helpers.
create or replace function public.beacon_hidden_from(p_device uuid, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.device_hidden_contacts
    where device_id = p_device and contact_user_id = p_user
  );
$$;

-- Replace the contact-read policy: global toggle AND accepted contact AND
-- not individually hidden. The old `hide_from_contact` coupling is gone,
-- since the Beacon now has its own per-person control.
drop policy if exists "contacts read shared devices" on public.devices;
create policy "contacts read shared devices"
  on public.devices for select
  to authenticated
  using (
    share_with_contacts
    and status <> 'unpaired'
    and not public.beacon_hidden_from(devices.id, auth.uid())
    and exists (
      select 1
      from public.emergency_contacts ec
      where ec.user_id = devices.user_id
        and ec.contact_user_id = auth.uid()
        and ec.status = 'accepted'
    )
  );
