-- Group chats. Only the peja super-admin account can create groups
-- or manage their membership. Members must already be elevated
-- (MVP / VIP / admin) — this mirrors the existing new-DM gate so
-- regular users are never reachable through chat at all.
--
-- Storage strategy: reuse the existing conversations +
-- conversation_participants tables. We add a few group-specific
-- columns rather than introducing a parallel schema, so all the
-- existing realtime / last-message-text / read-tracking machinery
-- keeps working unchanged for groups.

-- 1. Extend conversations with group metadata.
alter table public.conversations
  add column if not exists is_group boolean not null default false,
  add column if not exists group_name text,
  add column if not exists group_avatar_url text,
  add column if not exists created_by uuid references public.users(id) on delete set null;

-- 2. Per-participant role inside the conversation. For DMs every
--    row stays 'member' and the column is effectively unused.
alter table public.conversation_participants
  add column if not exists role text not null default 'member';
-- 'owner' | 'member'. We don't model co-admins yet (peja owns
-- groups fully — that's the product decision).

-- 3. Helper: is this user the peja super-admin? Centralises the
--    "what counts as peja" check so future cutovers (e.g. moving
--    to a dedicated is_super_admin flag) only touch this function.
create or replace function public.peja_is_super_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(u.email = 'pejastudios@gmail.com', false)
  from auth.users u
  where u.id = uid;
$$;

revoke all on function public.peja_is_super_admin(uuid) from public;
grant execute on function public.peja_is_super_admin(uuid) to authenticated;

-- 4. Create a group. Peja-only. Members must be elevated. Returns
--    the new conversation id so the client can navigate straight
--    into the group thread.
create or replace function public.peja_create_group(
  p_name text,
  p_avatar_url text,
  p_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
  mid uuid;
  is_elevated boolean;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if not public.peja_is_super_admin(me) then
    raise exception 'Only the peja account can create groups'
      using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Group name is required';
  end if;

  -- Verify every requested member is elevated before we create
  -- anything — fail-fast so a typo in the member list doesn't
  -- leave a half-built group behind.
  if p_member_ids is not null then
    foreach mid in array p_member_ids loop
      if mid = me then
        continue;
      end if;
      select coalesce(u.is_vip, false)
          or coalesce(u.is_mvp, false)
          or coalesce(u.is_admin, false)
        into is_elevated
      from public.users u
      where u.id = mid;
      if not coalesce(is_elevated, false) then
        raise exception 'Member % is not MVP / VIP / admin', mid;
      end if;
    end loop;
  end if;

  insert into public.conversations(
    is_group, group_name, group_avatar_url, created_by
  ) values (
    true, btrim(p_name), nullif(btrim(coalesce(p_avatar_url, '')), ''), me
  )
  returning id into conv_id;

  -- Peja is the owner.
  insert into public.conversation_participants(
    conversation_id, user_id, role
  ) values (conv_id, me, 'owner');

  -- Members.
  if p_member_ids is not null then
    foreach mid in array p_member_ids loop
      if mid = me then
        continue;
      end if;
      insert into public.conversation_participants(
        conversation_id, user_id, role
      ) values (conv_id, mid, 'member')
      on conflict do nothing;
    end loop;
  end if;

  return conv_id;
end;
$$;

revoke all on function public.peja_create_group(text, text, uuid[]) from public;
grant execute on function public.peja_create_group(text, text, uuid[]) to authenticated;

-- 5. Add one member to an existing group. Peja-only.
create or replace function public.peja_group_add_member(
  p_conversation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  is_elevated boolean;
  is_group_conv boolean;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not public.peja_is_super_admin(me) then
    raise exception 'Only the peja account can manage group members'
      using errcode = '42501';
  end if;

  select is_group into is_group_conv
  from public.conversations where id = p_conversation_id;
  if not coalesce(is_group_conv, false) then
    raise exception 'Not a group conversation';
  end if;

  select coalesce(u.is_vip, false)
      or coalesce(u.is_mvp, false)
      or coalesce(u.is_admin, false)
    into is_elevated
  from public.users u where u.id = p_user_id;
  if not coalesce(is_elevated, false) then
    raise exception 'User is not MVP / VIP / admin';
  end if;

  insert into public.conversation_participants(
    conversation_id, user_id, role
  ) values (p_conversation_id, p_user_id, 'member')
  on conflict do nothing;
end;
$$;

revoke all on function public.peja_group_add_member(uuid, uuid) from public;
grant execute on function public.peja_group_add_member(uuid, uuid) to authenticated;

-- 6. Remove one member from a group. Peja-only. The owner cannot
--    remove themselves through this path — they delete the group
--    instead.
create or replace function public.peja_group_remove_member(
  p_conversation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not public.peja_is_super_admin(me) then
    raise exception 'Only the peja account can manage group members'
      using errcode = '42501';
  end if;
  if p_user_id = me then
    raise exception 'Owner cannot be removed; delete the group instead';
  end if;

  delete from public.conversation_participants
  where conversation_id = p_conversation_id
    and user_id = p_user_id;
end;
$$;

revoke all on function public.peja_group_remove_member(uuid, uuid) from public;
grant execute on function public.peja_group_remove_member(uuid, uuid) to authenticated;

-- 7. Rename. Peja-only.
create or replace function public.peja_group_rename(
  p_conversation_id uuid,
  p_new_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not public.peja_is_super_admin(me) then
    raise exception 'Only the peja account can rename groups'
      using errcode = '42501';
  end if;
  if p_new_name is null or length(btrim(p_new_name)) = 0 then
    raise exception 'Group name is required';
  end if;

  update public.conversations
  set group_name = btrim(p_new_name)
  where id = p_conversation_id and is_group = true;
end;
$$;

revoke all on function public.peja_group_rename(uuid, text) from public;
grant execute on function public.peja_group_rename(uuid, text) to authenticated;

-- 8. Set / clear avatar. Peja-only. Pass null or empty string to
--    clear.
create or replace function public.peja_group_set_avatar(
  p_conversation_id uuid,
  p_new_avatar_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not public.peja_is_super_admin(me) then
    raise exception 'Only the peja account can change group avatars'
      using errcode = '42501';
  end if;

  update public.conversations
  set group_avatar_url = nullif(btrim(coalesce(p_new_avatar_url, '')), '')
  where id = p_conversation_id and is_group = true;
end;
$$;

revoke all on function public.peja_group_set_avatar(uuid, text) from public;
grant execute on function public.peja_group_set_avatar(uuid, text) to authenticated;

-- 9. Leave the group. Members only — the owner uses delete instead.
create or replace function public.peja_group_leave(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_role text;
begin
  if me is null then raise exception 'Not authenticated'; end if;

  select role into my_role
  from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = me;

  if my_role is null then
    raise exception 'Not a member of this group';
  end if;
  if my_role = 'owner' then
    raise exception 'Owner cannot leave; delete the group instead';
  end if;

  delete from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = me;
end;
$$;

revoke all on function public.peja_group_leave(uuid) from public;
grant execute on function public.peja_group_leave(uuid) to authenticated;

-- 10. Delete the group. Owner-only.
create or replace function public.peja_group_delete(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not public.peja_is_super_admin(me) then
    raise exception 'Only the peja account can delete groups'
      using errcode = '42501';
  end if;

  -- Cascading messages / participants is handled by the existing
  -- foreign-key constraints (on delete cascade is wired by the v1
  -- schema). If your environment doesn't have cascades, uncomment
  -- the explicit deletes below.
  -- delete from public.messages
  --   where conversation_id = p_conversation_id;
  -- delete from public.conversation_participants
  --   where conversation_id = p_conversation_id;

  delete from public.conversations
  where id = p_conversation_id and is_group = true;
end;
$$;

revoke all on function public.peja_group_delete(uuid) from public;
grant execute on function public.peja_group_delete(uuid) to authenticated;
