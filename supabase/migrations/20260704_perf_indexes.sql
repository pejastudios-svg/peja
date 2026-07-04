-- ============================================================================
-- Performance indexes for hot-path queries (audit finding S-11).
--
-- These are ADDITIVE and read-only in effect: an index only speeds up reads,
-- it never changes behaviour or data. Safe to apply.
--
-- Column names are derived from the app's actual .eq()/.order() filters (the
-- ground truth of what's queried). If any single CREATE INDEX errors on a
-- column that doesn't exist under a different name, that ONE line is the fix —
-- there is no data risk. The base tables live outside the repo, so these could
-- not be validated against the schema directly.
--
-- Scale note: on a very large table, prefer CREATE INDEX CONCURRENTLY (run
-- outside a transaction) to avoid a write lock during the build. At the
-- current data size a plain CREATE INDEX is fast enough and avoids the
-- "CONCURRENTLY cannot run inside a transaction block" gotcha with migration
-- runners.
-- ============================================================================

-- messages: every thread open filters by conversation_id and orders by
-- created_at; unread counts add sender_id/created_at. Only a pinned-message
-- partial index existed before this.
create index if not exists idx_messages_conv_created
  on public.messages (conversation_id, created_at desc);

-- conversation_participants: "list my conversations" and last_read_at lookups
-- filter by user_id. A (conversation_id, user_id) index existed; this covers
-- the user-first direction.
create index if not exists idx_conv_participants_user
  on public.conversation_participants (user_id);

-- notifications: the bell badge counts unread rows per user; the notifications
-- page lists them newest-first per user. (Digest-specific partial indexes from
-- 20260609 don't serve these two general queries.)
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id)
  where is_read = false;

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

-- posts: the feed/search pull the newest live/resolved posts. A country_code
-- partial index existed but not one on (status, created_at).
create index if not exists idx_posts_status_created
  on public.posts (status, created_at desc);

-- post_views: view counting scans all rows for a post.
create index if not exists idx_post_views_post
  on public.post_views (post_id);

-- safety_checkins: the check-in monitor cron scans by status + deadline and by
-- status + stale location. No index on this table existed in the repo.
create index if not exists idx_safety_checkins_status_next
  on public.safety_checkins (status, next_check_in_at);

create index if not exists idx_safety_checkins_status_locupd
  on public.safety_checkins (status, location_updated_at);

-- sos_alerts: the expire job and monitor scan by status + timestamps.
create index if not exists idx_sos_alerts_status_created
  on public.sos_alerts (status, created_at);

create index if not exists idx_sos_alerts_status_updated
  on public.sos_alerts (status, last_updated);

-- emergency_contacts: SOS/check-in fan-out reads a user's accepted contacts.
create index if not exists idx_emergency_contacts_user_status
  on public.emergency_contacts (user_id, status);

create index if not exists idx_emergency_contacts_contact_user
  on public.emergency_contacts (contact_user_id);

-- ---------------------------------------------------------------------------
-- VERIFY-FIRST: these two depend on a timestamp/column name that could not be
-- confirmed from the repo. If either errors, tell me the real column name and
-- I'll correct just that line. (user_sessions is written by AnalyticsTracker;
-- app_events by the same. Both are pruned by the analytics-retention cron.)
-- ---------------------------------------------------------------------------
create index if not exists idx_user_sessions_last_seen
  on public.user_sessions (last_seen_at);

create index if not exists idx_app_events_created
  on public.app_events (created_at);
