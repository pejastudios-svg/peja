-- Periodic cleanup for orphaned chat media in Supabase Storage.
--
-- IMPORTANT: This migration intentionally creates NO SQL function for
-- the cleanup. Supabase's `storage.objects` table has a
-- `protect_delete()` trigger that blocks raw DELETEs to prevent
-- accidental data loss / accounting drift. Storage deletions MUST go
-- through the Storage API (`supabase.storage.from(...).remove(...)`),
-- which Postgres functions can't reach.
--
-- An earlier draft of this migration tried `delete from
-- storage.objects ...` from a plpgsql function — it errored at runtime
-- with "Direct deletion from storage tables is not allowed."
--
-- The cleanup now lives in a Node.js admin route instead:
--   /api/admin/cleanup-orphan-chat-media
-- which uses the service-role client + Storage API to delete orphans
-- safely. Schedule it via Vercel cron (vercel.json `crons` entry) or
-- hit it manually with the CRON_SECRET bearer header.
--
-- This migration just drops any previous broken version of the
-- function from prior dev deploys, so the DB ends up clean.

drop function if exists public.peja_cleanup_orphan_chat_media(int);
drop function if exists public.peja_cleanup_orphan_chat_media();
