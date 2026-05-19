-- Atomic conversation-summary updates on message INSERT/UPDATE.
--
-- Background: until now, the chat client did this in two separate writes:
--   1. INSERT into messages
--   2. UPDATE conversations SET last_message_text = ..., last_message_at = ...
--
-- Step 2 was at-best best-effort. If the user navigated away, closed the
-- app, or hit a transient network blip between the two writes, the message
-- existed in the messages table but the parent conversations row still
-- pointed at the *previous* message. Users saw the conversation list
-- preview lag behind the actual thread by anywhere from seconds to
-- "until the next cold reload".
--
-- This migration moves the conversation-summary update server-side so
-- it's atomic with the INSERT. The client no longer needs to do that
-- second write at all.

-- =====================================================
-- Helper: derive last_message_text from a message row.
-- Mirrors the client's previous logic so existing UI looks the same.
-- =====================================================
create or replace function public.peja_message_preview(msg public.messages)
returns text
language plpgsql
immutable
as $$
begin
  if msg.is_deleted then
    return 'Message deleted';
  end if;

  if msg.content_type = 'text' then
    return left(coalesce(msg.content, ''), 100);
  end if;

  if msg.content_type = 'media' then
    return 'Sent an attachment';
  end if;

  if msg.content_type = 'document' then
    return 'Sent a document';
  end if;

  if msg.content_type = 'post_share' then
    return 'Shared a post';
  end if;

  if msg.content_type = 'system' then
    return left(coalesce(msg.content, ''), 100);
  end if;

  return left(coalesce(msg.content, 'New message'), 100);
end;
$$;

-- =====================================================
-- Trigger function: keep conversations row in sync with the most-recent
-- message. Runs AFTER INSERT and AFTER UPDATE on messages.
-- =====================================================
create or replace function public.peja_sync_conversation_from_message()
returns trigger
language plpgsql
security definer
as $$
declare
  current_last_at timestamptz;
begin
  -- Read the parent conversation's current last_message_at so we don't
  -- accidentally overwrite a NEWER message's summary with an edit to an
  -- older one. (Editing message N-1 shouldn't change the preview if
  -- message N exists.)
  select last_message_at into current_last_at
  from public.conversations
  where id = NEW.conversation_id;

  -- For INSERT, always update. For UPDATE, only patch the conversation row
  -- if this message is actually the latest one — otherwise an edit to an
  -- older message would clobber the most-recent preview.
  if TG_OP = 'INSERT'
     or current_last_at is null
     or NEW.created_at >= current_last_at then
    update public.conversations
    set
      last_message_text = peja_message_preview(NEW),
      last_message_at = NEW.created_at,
      last_message_sender_id = NEW.sender_id,
      updated_at = now()
    where id = NEW.conversation_id;
  end if;

  return NEW;
end;
$$;

-- =====================================================
-- Attach as AFTER INSERT and AFTER UPDATE triggers.
-- =====================================================
drop trigger if exists peja_messages_sync_conversation_ins on public.messages;
create trigger peja_messages_sync_conversation_ins
  after insert on public.messages
  for each row
  execute function public.peja_sync_conversation_from_message();

drop trigger if exists peja_messages_sync_conversation_upd on public.messages;
create trigger peja_messages_sync_conversation_upd
  after update on public.messages
  for each row
  when (
    -- Only fire when fields that affect the preview actually changed.
    -- Avoids spurious fires from read-receipt-like internal updates.
    OLD.content is distinct from NEW.content
    or OLD.is_deleted is distinct from NEW.is_deleted
    or OLD.content_type is distinct from NEW.content_type
    or OLD.edited_at is distinct from NEW.edited_at
  )
  execute function public.peja_sync_conversation_from_message();
