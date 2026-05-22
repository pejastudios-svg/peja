-- Fix: group create / member add / member remove / leave are failing
-- because the AFTER triggers on conversation_participants try to insert
-- a row into messages with content_type = 'system', and the v1 schema's
-- CHECK constraint on messages.content_type doesn't allow that value.
-- When the trigger raises, the whole transaction rolls back, so the
-- entire RPC fails with no message to the caller about what happened.
--
-- Two-part fix:
--
--   1. Drop the triggers. We move the system-message insert INSIDE
--      each RPC, wrapped in an EXCEPTION block so a constraint
--      failure on the announcement degrades silently instead of
--      taking the whole operation down. The announcement is a nice-
--      to-have; the membership change is the load-bearing part.
--
--   2. Try to widen the messages.content_type CHECK constraint to
--      include 'system' (so future writes can use the dedicated
--      type). We do this conservatively: detect any existing CHECK
--      naming pattern, drop it, recreate with the wider set. If the
--      column has no constraint, the ALTER is a no-op. Wrapped in
--      DO blocks so a mismatch doesn't fail the whole migration.

drop trigger if exists trg_peja_group_membership_join
  on public.conversation_participants;
drop trigger if exists trg_peja_group_membership_leave
  on public.conversation_participants;

-- Drop the trigger functions too so we don't leave dead code.
drop function if exists public.peja_group_membership_announce();
drop function if exists public.peja_group_membership_left();

-- Widen the content_type CHECK if one exists. Postgres names CHECK
-- constraints predictably ("<table>_<column>_check"). We also scan
-- pg_constraint for any other CHECK referencing content_type.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%content_type%'
  loop
    execute format('alter table public.messages drop constraint %I', c.conname);
  end loop;
  alter table public.messages
    add constraint messages_content_type_check
    check (content_type in ('text', 'media', 'document', 'post_share', 'audio', 'system'));
exception when others then
  -- If we can't widen the check (e.g. a column-level constraint we
  -- can't drop, or the column type itself disagrees), swallow the
  -- error. The system-message insert paths below also wrap their
  -- inserts in EXCEPTION blocks so the announcements degrade
  -- gracefully when the new value is rejected.
  raise notice 'content_type CHECK widening skipped: %', sqlerrm;
end$$;

-- Helper: announce a join. Caller passes the conversation id and the
-- joining user. Best-effort — failure to insert the system message
-- does NOT roll back the caller's transaction.
create or replace function public.peja_announce_join(
  p_conversation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  full_name text;
begin
  select u.full_name into full_name from public.users u where u.id = p_user_id;
  begin
    insert into public.messages(
      id, conversation_id, sender_id, content, content_type, metadata
    ) values (
      gen_random_uuid(),
      p_conversation_id,
      p_user_id,
      coalesce(full_name, 'A member') || ' joined the group',
      'system',
      jsonb_build_object('event', 'joined', 'user_id', p_user_id)
    );
  exception when others then
    raise notice 'peja_announce_join failed: %', sqlerrm;
  end;
end;
$$;

create or replace function public.peja_announce_leave(
  p_conversation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  full_name text;
begin
  select u.full_name into full_name from public.users u where u.id = p_user_id;
  begin
    insert into public.messages(
      id, conversation_id, sender_id, content, content_type, metadata
    ) values (
      gen_random_uuid(),
      p_conversation_id,
      p_user_id,
      coalesce(full_name, 'A member') || ' left the group',
      'system',
      jsonb_build_object('event', 'left', 'user_id', p_user_id)
    );
  exception when others then
    raise notice 'peja_announce_leave failed: %', sqlerrm;
  end;
end;
$$;

revoke all on function public.peja_announce_join(uuid, uuid) from public;
revoke all on function public.peja_announce_leave(uuid, uuid) from public;
grant execute on function public.peja_announce_join(uuid, uuid) to authenticated;
grant execute on function public.peja_announce_leave(uuid, uuid) to authenticated;

-- Re-create the group RPCs to call the helpers. Same external
-- behaviour as before; the only change is the announcement now
-- happens inside the RPC body (best-effort) instead of via a
-- trigger that could veto the whole operation.

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
  if me is null then raise exception 'Not authenticated'; end if;
  if not public.peja_is_super_admin(me) then
    raise exception 'Only the peja account can create groups'
      using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Group name is required';
  end if;

  if p_member_ids is not null then
    foreach mid in array p_member_ids loop
      if mid = me then continue; end if;
      select coalesce(u.is_vip, false)
          or coalesce(u.is_mvp, false)
          or coalesce(u.is_admin, false)
        into is_elevated
      from public.users u where u.id = mid;
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

  insert into public.conversation_participants(
    conversation_id, user_id, role
  ) values (conv_id, me, 'owner');

  if p_member_ids is not null then
    foreach mid in array p_member_ids loop
      if mid = me then continue; end if;
      insert into public.conversation_participants(
        conversation_id, user_id, role
      ) values (conv_id, mid, 'member')
      on conflict do nothing;
      -- Best-effort announcement per member.
      perform public.peja_announce_join(conv_id, mid);
    end loop;
  end if;

  return conv_id;
end;
$$;

revoke all on function public.peja_create_group(text, text, uuid[]) from public;
grant execute on function public.peja_create_group(text, text, uuid[]) to authenticated;

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
  perform public.peja_announce_join(p_conversation_id, p_user_id);
end;
$$;

revoke all on function public.peja_group_add_member(uuid, uuid) from public;
grant execute on function public.peja_group_add_member(uuid, uuid) to authenticated;

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
  where conversation_id = p_conversation_id and user_id = p_user_id;
  perform public.peja_announce_leave(p_conversation_id, p_user_id);
end;
$$;

revoke all on function public.peja_group_remove_member(uuid, uuid) from public;
grant execute on function public.peja_group_remove_member(uuid, uuid) to authenticated;

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
  perform public.peja_announce_leave(p_conversation_id, me);
end;
$$;

revoke all on function public.peja_group_leave(uuid) from public;
grant execute on function public.peja_group_leave(uuid) to authenticated;
