-- Fix: personal-place visibility must EQUAL dot visibility.
--
-- The original policy only let a viewer read places of people who added
-- them as a protector. But the map shows a person's dot in two directions
-- (see 20260713_presence.sql): protectors see their owners, and owners see
-- protectors who set share_back. Someone whose live position you can watch
-- would still hide their places from you, which reads as a bug, and was.
--
-- Rule now mirrored one-for-one from "circle presence read", including
-- hide_from_contact: if they paused you from seeing their dot, you do not
-- see their places either.

drop policy if exists "contacts read circle places" on public.places;
create policy "contacts read circle places"
  on public.places for select
  to authenticated
  using (
    visible_to_circle
    and device_id is null
    and (
      exists (
        select 1 from public.emergency_contacts ec
        where ec.user_id = places.owner_user_id
          and ec.contact_user_id = auth.uid()
          and ec.status = 'accepted'
          and ec.hide_from_contact = false
      )
      or exists (
        select 1 from public.emergency_contacts ec
        where ec.user_id = auth.uid()
          and ec.contact_user_id = places.owner_user_id
          and ec.status = 'accepted'
          and ec.share_back = true
      )
    )
  );
