-- Fix: the contact_groups <-> contact_group_members RLS policies each
-- queried the other table, and Postgres rejects that as infinite policy
-- recursion - every client read failed (writes were fine because the
-- service role bypasses RLS). SECURITY DEFINER helpers break the loop:
-- inside them, RLS does not re-trigger.

create or replace function public.is_group_owner(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from contact_groups
    where id = gid and owner_id = auth.uid()
  );
$$;

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from contact_group_members
    where group_id = gid and member_user_id = auth.uid()
  );
$$;

drop policy if exists "members read their groups" on public.contact_groups;
create policy "members read their groups"
  on public.contact_groups for select
  to authenticated
  using (owner_id = auth.uid() or public.is_group_member(id));

drop policy if exists "read group membership" on public.contact_group_members;
create policy "read group membership"
  on public.contact_group_members for select
  to authenticated
  using (member_user_id = auth.uid() or public.is_group_owner(group_id));

drop policy if exists "owners remove members" on public.contact_group_members;
create policy "owners remove members"
  on public.contact_group_members for delete
  to authenticated
  using (member_user_id = auth.uid() or public.is_group_owner(group_id));
