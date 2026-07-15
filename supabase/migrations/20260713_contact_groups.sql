-- Community groups: named audiences within your emergency contacts
-- ("Family", "Work friends"). Used as one-tap sharing targets for SML
-- (a group tick selects all its accepted members - the check-in pipeline
-- itself still receives a flat contact_ids list, unchanged).
--
-- Consent model: being someone's accepted emergency contact does NOT
-- auto-consent to group membership. Every add creates a PENDING row and
-- a notification ("X added you to their Family circle"); the member
-- accepts or declines. Members can be in many groups.

create table if not exists public.contact_groups (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);

create index if not exists contact_groups_owner_idx on public.contact_groups (owner_id);

create table if not exists public.contact_group_members (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.contact_groups(id) on delete cascade,
  member_user_id uuid not null references public.users(id) on delete cascade,
  status         text not null default 'pending'
                 check (status in ('pending','accepted','declined')),
  created_at     timestamptz not null default now(),
  unique (group_id, member_user_id)
);

create index if not exists cgm_member_idx on public.contact_group_members (member_user_id);

alter table public.contact_groups enable row level security;
alter table public.contact_group_members enable row level security;

-- Owners manage their groups; members can see groups they belong to.
drop policy if exists "owners manage groups" on public.contact_groups;
create policy "owners manage groups"
  on public.contact_groups for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "members read their groups" on public.contact_groups;
create policy "members read their groups"
  on public.contact_groups for select
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.contact_group_members m
      where m.group_id = contact_groups.id
        and m.member_user_id = auth.uid()
    )
  );

-- Membership rows: owner reads all rows of their groups; member reads
-- and updates (accept/decline) their own row. Writes that ADD members
-- go through the service-role API (validates the contact relationship).
drop policy if exists "read group membership" on public.contact_group_members;
create policy "read group membership"
  on public.contact_group_members for select
  to authenticated
  using (
    member_user_id = auth.uid()
    or exists (
      select 1 from public.contact_groups g
      where g.id = contact_group_members.group_id and g.owner_id = auth.uid()
    )
  );

drop policy if exists "members respond" on public.contact_group_members;
create policy "members respond"
  on public.contact_group_members for update
  to authenticated
  using (member_user_id = auth.uid())
  with check (member_user_id = auth.uid());

drop policy if exists "owners remove members" on public.contact_group_members;
create policy "owners remove members"
  on public.contact_group_members for delete
  to authenticated
  using (
    member_user_id = auth.uid()
    or exists (
      select 1 from public.contact_groups g
      where g.id = contact_group_members.group_id and g.owner_id = auth.uid()
    )
  );

comment on table public.contact_groups is
  'Named sharing audiences within a user''s community (SML group targets).';
comment on table public.contact_group_members is
  'Group membership with explicit accept/decline consent per member.';
