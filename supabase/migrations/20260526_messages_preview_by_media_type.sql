-- Widen `peja_message_preview` so conversation-list previews reflect the
-- *kind* of media that was sent rather than the generic
-- "Sent an attachment" string the previous version always wrote.
--
-- Before:
--   "Sent an attachment"  for any media-typed message (image, video, audio…)
--
-- After:
--   "📷 Photo"        when the first attached row is an image
--   "🎥 Video"        when it's a video
--   "🎙 Voice note"   when it's an audio file
--   "📎 File"         when it's a generic document
--   "Sent an attachment"  fallback if message_media has no rows
--                          (e.g. a media-typed message inserted before
--                           its media row in the same transaction)
--
-- The trigger that calls this function is unchanged — it still fires on
-- messages INSERT/UPDATE and writes to conversations.last_message_text.
-- This is purely a preview-string upgrade.

create or replace function public.peja_message_preview(msg public.messages)
returns text
language plpgsql
stable
as $$
declare
  first_media_type text;
begin
  if msg.is_deleted then
    return 'Message deleted';
  end if;

  if msg.content_type = 'text' then
    return left(coalesce(msg.content, ''), 100);
  end if;

  if msg.content_type = 'media' then
    -- Look up the first attached media row's type. Limit 1 because we
    -- only need one to decide the icon; ordering by created_at gives
    -- determinism if multiple rows arrived in one tx.
    select media_type into first_media_type
    from public.message_media
    where message_id = msg.id
    order by created_at asc
    limit 1;

    if first_media_type = 'image' then
      return '📷 Photo';
    elsif first_media_type = 'video' then
      return '🎥 Video';
    elsif first_media_type = 'audio' then
      return '🎙 Voice note';
    elsif first_media_type = 'document' then
      return '📎 File';
    end if;

    -- Fallback when no media row exists yet (e.g. trigger fired between
    -- the messages INSERT and the message_media INSERT). Same generic
    -- string the previous version always wrote; client UI can keep its
    -- "Sent an attachment" → "📷 Photo" fallback for safety.
    return 'Sent an attachment';
  end if;

  if msg.content_type = 'document' then
    return '📎 File';
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
