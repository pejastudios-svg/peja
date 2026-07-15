-- Owner-controlled "members can see each other" per circle. Off by
-- default (private roster); when the owner turns it on, accepted members
-- can read each other's membership rows and appear to each other on the
-- map sheet. Only the owner can flip it (enforced in the groups API).

alter table public.contact_groups
  add column if not exists members_visible boolean not null default false;

-- Recursion-safe helper: is the current user an accepted member of a
-- circle whose owner allowed member-visibility? SECURITY DEFINER so RLS
-- does not re-trigger inside it (same pattern as is_group_owner).
create or replace function public.can_see_group_members(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from contact_groups g
    join contact_group_members m
      on m.group_id = g.id
     and m.member_user_id = auth.uid()
     and m.status = 'accepted'
    where g.id = gid and g.members_visible = true
  );
$$;

-- Widen membership reads: own row, owner, OR co-member when the circle
-- has member-visibility on.
drop policy if exists "read group membership" on public.contact_group_members;
create policy "read group membership"
  on public.contact_group_members for select
  to authenticated
  using (
    member_user_id = auth.uid()
    or public.is_group_owner(group_id)
    or public.can_see_group_members(group_id)
  );
