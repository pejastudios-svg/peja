-- Adds post_comments.status so the report-driven auto-removal flow can
-- archive a comment instead of hard-deleting it. Mirrors posts.status:
-- 'live' is the default, 'archived' hides the comment from end users
-- but keeps the row around for admin/guardian review and audit trail.
--
-- User-facing comment queries need to filter on status='live'; admin
-- and moderation queues continue to read all rows.

alter table public.post_comments
  add column if not exists status text not null default 'live'
    check (status in ('live', 'archived'));

-- Most comment fetches are "live comments for post X, newest first" —
-- a partial index on the live rows scoped to post_id keeps that path
-- fast without indexing archived rows we rarely scan.
create index if not exists idx_post_comments_live_post_created
  on public.post_comments (post_id, created_at desc)
  where status = 'live';
