-- Single-round-trip DM notification dispatcher. Folds the four
-- separate REST calls in /api/notify-social's handleDM (mute check +
-- unread count + digest lookup + delete-old-digest + insert-new) into
-- one Postgres function so the route makes ONE network round-trip
-- instead of four.
--
-- Background: on a slow client → Supabase link (~700ms RTT), each
-- REST call cost ~700ms even when Postgres-side work was sub-ms.
-- The pre-refactor toast latency was ~6.8s; after batching round-trips
-- it dropped to ~3.8s and this function takes it to ~1s (auth + 1 RTT).
--
-- Returns:
--   delivery_mode = 'muted'      → recipient has notification_mode='muted'
--                                  (or legacy is_muted=true with no mode).
--                                  No row inserted, no realtime fired.
--   delivery_mode = 'individual' → new dm_message row inserted; the
--                                  realtime INSERT broadcast fires the
--                                  receiver's toast. Caller still fires
--                                  the FCM push.
--   delivery_mode = 'digest'     → previous unread digest (if any) was
--                                  deleted and a fresh dm_message_digest
--                                  was inserted. Realtime INSERT fires.
--                                  Caller does NOT FCM-push (digest mode
--                                  intentionally avoids per-message pings).
--   total                        → the unread count carried in the digest
--                                  body. 1 for individual mode. 0 for muted.

create or replace function public.peja_notify_dm(
  p_conversation_id uuid,
  p_recipient_id uuid,
  p_actor_name text,
  p_preview text,
  p_digest_threshold int default 3
)
returns table (
  notification_id uuid,
  delivery_mode text,
  total int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_is_muted boolean;
  v_participant_found boolean := false;
  v_unread_count int;
  v_digest_id uuid;
  v_digest_total int;
  v_new_id uuid := gen_random_uuid();
  v_title text := '📩 ' || p_actor_name;
  v_body text;
  v_total int;
begin
  -- 1. Mute check. Defensive about the notification_mode column —
  --    pre-20260606 schemas only have is_muted. Wrap in begin/exception
  --    so a missing column gracefully falls back to the legacy boolean.
  begin
    select notification_mode, is_muted into v_mode, v_is_muted
    from public.conversation_participants
    where conversation_id = p_conversation_id
      and user_id = p_recipient_id
    limit 1;
    if found then v_participant_found := true; end if;
  exception when undefined_column then
    select is_muted into v_is_muted
    from public.conversation_participants
    where conversation_id = p_conversation_id
      and user_id = p_recipient_id
    limit 1;
    if found then v_participant_found := true; end if;
    v_mode := null;
  end;

  -- An explicit 'muted' mode or (legacy) is_muted=true with no mode
  -- suppresses delivery. 'mentions' / 'all' fall through; mention-only
  -- filtering happens client-side in the sender's fan-out before the
  -- POST is made.
  if v_mode = 'muted' or (v_mode is null and coalesce(v_is_muted, false)) then
    return query select null::uuid, 'muted'::text, 0;
    return;
  end if;

  -- 2. Look up the existing unread digest (if any). One row at most.
  select id, coalesce((data->>'total')::int, 0)
    into v_digest_id, v_digest_total
  from public.notifications
  where user_id = p_recipient_id
    and type = 'dm_message_digest'
    and (data->>'conversation_id') = p_conversation_id::text
    and is_read = false
  limit 1;

  -- 3. Bounded unread count. We only need to know if >=
  --    p_digest_threshold; the LIMIT lets Postgres short-circuit at
  --    the index level (see idx_notifications_user_type_conv_unread).
  --    A precise total is only needed for the first digest transition;
  --    after that the digest row's own .total is the source of truth.
  select count(*)::int into v_unread_count
  from (
    select 1
    from public.notifications
    where user_id = p_recipient_id
      and type = 'dm_message'
      and (data->>'conversation_id') = p_conversation_id::text
      and is_read = false
    limit p_digest_threshold
  ) t;

  -- 4. Digest mode: either a digest already exists, or this incoming
  --    message pushes us over the threshold. Delete the stale digest
  --    (if any) and INSERT a fresh one so the receiver's INSERT-only
  --    realtime listener fires.
  if v_digest_id is not null or v_unread_count >= p_digest_threshold then
    v_total := coalesce(nullif(v_digest_total, 0), v_unread_count) + 1;
    v_body := 'You have ' || v_total || ' unread messages';
    if v_digest_id is not null then
      delete from public.notifications where id = v_digest_id;
    end if;
    insert into public.notifications(id, user_id, type, title, body, data, is_read)
    values (
      v_new_id,
      p_recipient_id,
      'dm_message_digest',
      v_title,
      v_body,
      jsonb_build_object(
        'conversation_id', p_conversation_id::text,
        'sender_name', p_actor_name,
        'total', v_total
      ),
      false
    );
    return query select v_new_id, 'digest'::text, v_total;
    return;
  end if;

  -- 5. Individual notification. Truncate the preview to 60 chars to
  --    match the route's previous behaviour.
  if p_preview is null or p_preview = '' then
    v_body := 'Sent you a message';
  elsif length(p_preview) > 60 then
    v_body := substring(p_preview for 60) || '...';
  else
    v_body := p_preview;
  end if;

  insert into public.notifications(id, user_id, type, title, body, data, is_read)
  values (
    v_new_id,
    p_recipient_id,
    'dm_message',
    v_title,
    v_body,
    jsonb_build_object(
      'conversation_id', p_conversation_id::text,
      'sender_name', p_actor_name
    ),
    false
  );

  return query select v_new_id, 'individual'::text, 1;
end;
$$;

-- Only the service role should be able to invoke this. End-users
-- calling it directly could spam notifications to other users.
revoke all on function public.peja_notify_dm(uuid, uuid, text, text, int) from public;
grant execute on function public.peja_notify_dm(uuid, uuid, text, text, int) to service_role;
