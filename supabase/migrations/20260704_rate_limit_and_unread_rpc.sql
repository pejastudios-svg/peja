-- ============================================================================
-- Bucket 2, part 1: two additive Postgres functions (audit S-7, S-2).
--
-- Both are SAFE to apply: creating a function/table changes nothing about the
-- running app. The app keeps using its current code paths until we separately
-- switch a call site over to these — so applying this migration on its own has
-- zero behavioural effect.
--
-- Held back for now (they MUTATE data and depend on tables not in the repo):
--   * atomic post-view counting (needs the post_views unique constraint)
--   * find_or_create_dm hardening (needs the conversations base schema)
-- We'll add those once we've confirmed those tables in the dashboard.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- S-7: durable, cross-instance rate limiting.
--
-- The current limiter is an in-memory Map per serverless instance, so it
-- resets on cold start and doesn't share state across instances (useless at
-- scale). This table + function is a shared source of truth. Self-contained:
-- it creates a NEW table and touches nothing else.
--
-- Usage from a route (service role):
--   const { data: allowed } = await admin.rpc('peja_rate_limit_hit', {
--     p_key: `reset:${email}`, p_max: 5, p_window_seconds: 900 });
--   if (!allowed) return 429;
-- ---------------------------------------------------------------------------
create table if not exists public.peja_rate_limits (
  key           text primary key,
  window_start  timestamptz not null default now(),
  count         integer     not null default 0
);

-- Lock the table down: only the service role (server routes) touches it.
alter table public.peja_rate_limits enable row level security;
revoke all on public.peja_rate_limits from anon, authenticated;

-- Returns TRUE if the action is allowed (and records it), FALSE if the caller
-- is over p_max within the rolling p_window_seconds. Atomic under concurrency
-- via the upsert + row lock.
create or replace function public.peja_rate_limit_hit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := now();
  v_count  integer;
  v_start  timestamptz;
begin
  insert into public.peja_rate_limits (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set
      -- If the previous window has expired, start a fresh one at 1;
      -- otherwise increment within the current window.
      count = case
        when public.peja_rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
          then 1
        else public.peja_rate_limits.count + 1
      end,
      window_start = case
        when public.peja_rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
          then v_now
        else public.peja_rate_limits.window_start
      end
  returning count, window_start into v_count, v_start;

  return v_count <= p_max;
end;
$$;

-- Only server routes (service role) call this; do not expose to clients.
revoke all on function public.peja_rate_limit_hit(text, integer, integer) from anon, authenticated;

-- Optional housekeeping: an index so a future cleanup of stale rows is cheap.
create index if not exists idx_peja_rate_limits_window
  on public.peja_rate_limits (window_start);


-- ---------------------------------------------------------------------------
-- S-2: unread counts in ONE query instead of one COUNT per conversation.
--
-- Read-only. Derives the caller from auth.uid() so it can ONLY ever return the
-- signed-in user's own counts (never another user's), and runs as SECURITY
-- DEFINER so it isn't slowed by per-row RLS on messages.
--
-- Replaces the N+1 loop in features/chat/api.ts once the client is switched to:
--   const { data } = await supabase.rpc('peja_unread_counts');
--   // data: [{ conversation_id, unread }, ...]
--
-- Assumes id columns are uuid. If they're a different type the CREATE errors
-- cleanly and we adjust the signature — no data risk.
-- ---------------------------------------------------------------------------
create or replace function public.peja_unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql
security definer
set search_path = public
as $$
  select
    cp.conversation_id,
    count(m.id) as unread
  from public.conversation_participants cp
  left join public.messages m
    on m.conversation_id = cp.conversation_id
   and m.sender_id <> cp.user_id
   and m.is_deleted = false
   and (cp.last_read_at is null or m.created_at > cp.last_read_at)
  where cp.user_id = auth.uid()
  group by cp.conversation_id;
$$;

grant execute on function public.peja_unread_counts() to authenticated;
