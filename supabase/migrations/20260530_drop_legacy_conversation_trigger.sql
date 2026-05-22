-- Drop the legacy v1 trigger that competes with the v2
-- peja_messages_sync_conversation_ins trigger.
--
-- Why this exists:
-- Both triggers fire AFTER INSERT on `messages`. Postgres orders
-- triggers alphabetically by name, so the sequence was:
--
--   1. peja_messages_sync_conversation_ins  → writes the new
--      type-specific preview ("🎙 Voice note", "📎 File", etc.)
--      via peja_message_preview().
--   2. trg_update_conversation_last_message → runs an OLDER
--      v1-era function (update_conversation_last_message) that
--      overwrites last_message_text with a generic string
--      ("📎 Media"), silently undoing the v2 work.
--
-- The v2 trigger is the source of truth now, so we just drop the
-- legacy one. We do NOT drop update_conversation_last_message()
-- itself in case anything else still references it — orphan
-- functions are harmless; an active trigger writing the wrong
-- string is not.

drop trigger if exists trg_update_conversation_last_message
  on public.messages;
