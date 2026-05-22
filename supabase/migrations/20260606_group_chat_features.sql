-- Foundation schema for the group-chat feature pass:
--
--   1. Per-user pinning of conversations (DMs OR groups). Pinned
--      rows sort to the top of the conversation list regardless of
--      last_message_at.
--   2. Per-user notification mode on a conversation — replaces the
--      binary is_muted with a three-way choice ('all', 'mentions',
--      'muted') so group members can opt in to only-when-mentioned
--      pings.
--   3. Per-message pinning. Anyone in the conversation can pin a
--      message — it surfaces in a pinned bar at the top of the
--      thread so the group's announcements / important context
--      stay one tap away.
--   4. System messages. content_type = 'system' rows that the
--      thread renders as centred-banner pills instead of bubbles.
--      Used for "X joined" / "X left" / "Renamed to …" / etc.
--      Triggers below auto-insert the join/leave system rows.
--   5. Per-message reports — extends user_reports with an optional
--      message_id so users can flag a specific message inside a
--      group rather than the user globally.

-- 1. Pin a conversation per-user.
alter table public.conversation_participants
  add column if not exists is_pinned boolean not null default false,
  add column if not exists pinned_at timestamptz;

-- 2. Notification mode per-user. Keep the existing is_muted column
--    (other code paths still read it) but introduce notification_mode
--    as the source of truth going forward. The app sets both in lock
--    step so legacy is_muted readers see 'mentions' / 'muted' as
--    muted.
alter table public.conversation_participants
  add column if not exists notification_mode text not null default 'all'
    check (notification_mode in ('all', 'mentions', 'muted'));

-- 3. Per-message pinning + a small index so the pinned bar's
--    "fetch most recent N pinned" query stays fast.
alter table public.messages
  add column if not exists is_pinned boolean not null default false,
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.users(id) on delete set null;

create index if not exists idx_messages_pinned_in_conv
  on public.messages(conversation_id, pinned_at desc)
  where is_pinned = true;

-- 4. System message support — most schemas already allow arbitrary
--    text in content_type; we standardise on 'system' and leave the
--    content column to carry a short human-readable payload that the
--    client renders verbatim (the wire format is intentionally dumb
--    so an old client doesn't render garbage when we add new system
--    event kinds later).

-- 4a. Trigger: when a participant row is INSERTed, emit a "joined"
--     system message. Skips when the inserted user is the
--     conversation creator (the create_group RPC adds the owner
--     itself, which doesn't need an announcement).
create or replace function public.peja_group_membership_announce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_is_group boolean;
  full_name text;
  conv_created_by uuid;
begin
  select c.is_group, c.created_by into conv_is_group, conv_created_by
  from public.conversations c
  where c.id = new.conversation_id;
  if not coalesce(conv_is_group, false) then
    return new;
  end if;
  if new.user_id = conv_created_by then
    return new;
  end if;
  select u.full_name into full_name from public.users u where u.id = new.user_id;
  insert into public.messages(
    id, conversation_id, sender_id, content, content_type, metadata
  ) values (
    gen_random_uuid(),
    new.conversation_id,
    new.user_id,
    coalesce(full_name, 'A member') || ' joined the group',
    'system',
    jsonb_build_object('event', 'joined', 'user_id', new.user_id)
  );
  return new;
end;
$$;

drop trigger if exists trg_peja_group_membership_join on public.conversation_participants;
create trigger trg_peja_group_membership_join
  after insert on public.conversation_participants
  for each row execute function public.peja_group_membership_announce();

-- 4b. Trigger: when a participant row is DELETEd, emit a "left"
--     system message AFTER the delete so existing-member counts
--     reflect the change before the message lands.
create or replace function public.peja_group_membership_left()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_is_group boolean;
  full_name text;
begin
  select c.is_group into conv_is_group
  from public.conversations c
  where c.id = old.conversation_id;
  if not coalesce(conv_is_group, false) then
    return old;
  end if;
  select u.full_name into full_name from public.users u where u.id = old.user_id;
  -- sender_id null isn't allowed by some schemas; use the leaver's
  -- own id so RLS doesn't reject the insert.
  insert into public.messages(
    id, conversation_id, sender_id, content, content_type, metadata
  ) values (
    gen_random_uuid(),
    old.conversation_id,
    old.user_id,
    coalesce(full_name, 'A member') || ' left the group',
    'system',
    jsonb_build_object('event', 'left', 'user_id', old.user_id)
  );
  return old;
end;
$$;

drop trigger if exists trg_peja_group_membership_leave on public.conversation_participants;
create trigger trg_peja_group_membership_leave
  after delete on public.conversation_participants
  for each row execute function public.peja_group_membership_left();

-- 5. Per-message reports — single column added to the existing
--    user_reports table so the admin inbox stays one query.
alter table public.user_reports
  add column if not exists message_id uuid references public.messages(id) on delete set null;

create index if not exists idx_user_reports_message_id
  on public.user_reports(message_id)
  where message_id is not null;

-- 6. Pin / unpin a conversation for the current user. Cheap
--    RPC wrapper so the client can fire one round-trip and keep
--    the (is_pinned, pinned_at) pair in sync.
create or replace function public.peja_conv_set_pinned(
  p_conversation_id uuid,
  p_pinned boolean
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
  update public.conversation_participants
  set is_pinned = coalesce(p_pinned, false),
      pinned_at = case when p_pinned then now() else null end
  where conversation_id = p_conversation_id and user_id = me;
end;
$$;

revoke all on function public.peja_conv_set_pinned(uuid, boolean) from public;
grant execute on function public.peja_conv_set_pinned(uuid, boolean) to authenticated;

-- 7. Pin / unpin a message. Any participant can pin in their own
--    conversations. peja_can_pin keeps the rule pluggable — today
--    it's "you must be a participant", tomorrow we can lock it to
--    owners-only in groups by swapping out this function.
create or replace function public.peja_message_set_pinned(
  p_message_id uuid,
  p_pinned boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  is_participant boolean;
  conv_id uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;

  select conversation_id into conv_id
  from public.messages where id = p_message_id;
  if conv_id is null then
    raise exception 'Message not found';
  end if;

  select exists(
    select 1 from public.conversation_participants
    where conversation_id = conv_id and user_id = me
  ) into is_participant;
  if not coalesce(is_participant, false) then
    raise exception 'Not a participant of this conversation'
      using errcode = '42501';
  end if;

  update public.messages
  set is_pinned = coalesce(p_pinned, false),
      pinned_at = case when p_pinned then now() else null end,
      pinned_by = case when p_pinned then me else null end
  where id = p_message_id;
end;
$$;

revoke all on function public.peja_message_set_pinned(uuid, boolean) from public;
grant execute on function public.peja_message_set_pinned(uuid, boolean) to authenticated;

-- 8. Set per-conversation notification mode. Mirrors is_muted so
--    callers reading the legacy flag still get the right answer
--    for 'mentions' / 'muted'.
create or replace function public.peja_conv_set_notification_mode(
  p_conversation_id uuid,
  p_mode text
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
  if p_mode not in ('all', 'mentions', 'muted') then
    raise exception 'Invalid notification mode: %', p_mode;
  end if;
  update public.conversation_participants
  set notification_mode = p_mode,
      is_muted = (p_mode <> 'all')
  where conversation_id = p_conversation_id and user_id = me;
end;
$$;

revoke all on function public.peja_conv_set_notification_mode(uuid, text) from public;
grant execute on function public.peja_conv_set_notification_mode(uuid, text) to authenticated;
