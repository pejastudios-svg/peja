-- Targeted broadcasts.
--
-- Built general rather than for the one message that prompted it. The
-- immediate need is telling existing users to set up recovery codes, but
-- the same machinery carries safety messages at Christmas and New Year's
-- Eve, greetings on Children's Day, and anything else worth saying to a
-- subset of people.
--
-- Two ideas do the work:
--
--   audience  - who, evaluated per user rather than materialised. A
--               recipient list for a million users would be a million rows
--               per message; checking one user against a filter is a few
--               indexed lookups. Push and in-app sends resolve the filter
--               once at send time; popups re-check it per viewer.
--
--   delivery  - how. push goes to the lock screen, in_app writes a
--               notification row, popup shows a card on next open. The
--               distinction matters: a push body is readable by anyone
--               near the phone, so anything sensitive (violence against
--               women, suicide prevention) goes in_app or popup only,
--               where it stays behind the login.

create extension if not exists "pgcrypto";

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,

  -- Shown under the body. Exists because "today is Suicide Prevention Day"
  -- with nothing attached is hollow; a heavy message should carry a number
  -- or a link someone can actually use.
  resource_text text,
  action_url text,

  -- {"kind":"all"} | {"kind":"no_recovery_codes"} | {"kind":"no_contacts"}
  -- | {"kind":"states","states":[...]} | {"kind":"role","role":"guardian"}
  -- | {"kind":"inactive","days":30}
  audience jsonb not null default '{"kind":"all"}'::jsonb,

  delivery text not null check (delivery in ('push', 'in_app', 'popup')),
  status text not null default 'draft' check (status in ('draft', 'sent')),

  -- Popups are live between these; null means as soon as sent, forever.
  starts_at timestamptz,
  ends_at timestamptz,

  sent_at timestamptz,
  sent_count integer not null default 0,

  -- Set by the milestone cron, e.g. 'independence-2026'. The unique index
  -- below is what stops a daily job, a retry, or a double-trigger from
  -- sending the same Christmas message twice.
  milestone_key text,

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists broadcasts_milestone_key_idx
  on public.broadcasts (milestone_key)
  where milestone_key is not null;

-- The popup lookup: live popups, newest first. Partial because popups are
-- a small slice and nothing else needs this path.
create index if not exists broadcasts_live_popups_idx
  on public.broadcasts (status, ends_at)
  where delivery = 'popup';

create index if not exists broadcasts_created_at_idx
  on public.broadcasts (created_at desc);

-- One row per person who closed a popup. Composite primary key doubles as
-- the lookup index and makes a repeat dismissal a no-op.
create table if not exists public.broadcast_dismissals (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (broadcast_id, user_id)
);

-- Everything reaches these tables through service-role API routes, which
-- bypass RLS. Enabled with no policies so nothing is readable or writable
-- directly from a client holding an anon key.
alter table public.broadcasts enable row level security;
alter table public.broadcast_dismissals enable row level security;

revoke all on public.broadcasts from anon, authenticated;
revoke all on public.broadcast_dismissals from anon, authenticated;

-- =====================================================================
-- Audience resolution
-- =====================================================================
--
-- Two entry points for the same rules. broadcast_recipients fans a push
-- or in-app message out at send time; broadcast_matches answers "should
-- THIS person see this popup" on app open. Keeping both in SQL means the
-- rules cannot drift apart, and keeps a million-row anti-join out of the
-- Node process.
--
-- SECURITY DEFINER because these read across users, recovery_codes,
-- emergency_contacts and devices, which RLS otherwise restricts to the
-- owner. Execute is granted to nobody; the service role calls them.
--
-- to_jsonb(selected_states) rather than reading the column directly, so
-- this works whether that column is text[], json or jsonb.

create or replace function public.broadcast_recipients(p_audience jsonb)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k text := p_audience->>'kind';
begin
  if k = 'all' then
    return query
      select u.id from public.users u
      where coalesce(u.status, 'active') = 'active';

  elsif k = 'no_recovery_codes' then
    return query
      select u.id from public.users u
      where coalesce(u.status, 'active') = 'active'
        and not exists (select 1 from public.recovery_codes rc where rc.user_id = u.id);

  elsif k = 'no_contacts' then
    return query
      select u.id from public.users u
      where coalesce(u.status, 'active') = 'active'
        and (
          select count(*) from public.emergency_contacts ec
          where ec.user_id = u.id and ec.status = 'accepted'
        ) < 2;

  elsif k = 'states' then
    return query
      select distinct us.user_id
      from public.user_settings us
      join public.users u on u.id = us.user_id
       and coalesce(u.status, 'active') = 'active'
      where exists (
        select 1
        from jsonb_array_elements_text(coalesce(to_jsonb(us.selected_states), '[]'::jsonb)) s
        join jsonb_array_elements_text(coalesce(p_audience->'states', '[]'::jsonb)) t on t = s
      );

  elsif k = 'role' then
    return query
      select u.id from public.users u
      where coalesce(u.status, 'active') = 'active'
        and (
          (p_audience->>'role' = 'guardian' and coalesce(u.is_guardian, false))
          or (p_audience->>'role' = 'vip' and coalesce(u.is_vip, false))
          or (p_audience->>'role' = 'mvp' and coalesce(u.is_mvp, false))
          or (
            p_audience->>'role' = 'beacon_owner'
            and exists (
              select 1 from public.devices d
              where d.user_id = u.id and d.status is distinct from 'unpaired'
            )
          )
        );

  elsif k = 'inactive' then
    return query
      select u.id from public.users u
      where coalesce(u.status, 'active') = 'active'
        and (
          u.last_seen_at is null
          or u.last_seen_at < now() - make_interval(
               days => greatest(coalesce((p_audience->>'days')::int, 30), 1))
        );
  end if;

  -- Unknown kind sends to nobody. Failing closed beats blasting everyone
  -- because of a typo in a filter.
  return;
end;
$$;

-- Per-user, and deliberately NOT "is p_user in broadcast_recipients(...)".
-- That form resolves the whole recipient set on every app open, which is a
-- full table scan per viewer and the exact cost this split exists to
-- avoid. Each branch below touches one user's rows through an index.
create or replace function public.broadcast_matches(p_user uuid, p_audience jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k text := p_audience->>'kind';
begin
  if not exists (
    select 1 from public.users u
    where u.id = p_user and coalesce(u.status, 'active') = 'active'
  ) then
    return false;
  end if;

  if k = 'all' then
    return true;

  elsif k = 'no_recovery_codes' then
    return not exists (select 1 from public.recovery_codes rc where rc.user_id = p_user);

  elsif k = 'no_contacts' then
    return (
      select count(*) from public.emergency_contacts ec
      where ec.user_id = p_user and ec.status = 'accepted'
    ) < 2;

  elsif k = 'states' then
    return exists (
      select 1
      from public.user_settings us
      where us.user_id = p_user
        and exists (
          select 1
          from jsonb_array_elements_text(coalesce(to_jsonb(us.selected_states), '[]'::jsonb)) s
          join jsonb_array_elements_text(coalesce(p_audience->'states', '[]'::jsonb)) t on t = s
        )
    );

  elsif k = 'role' then
    return exists (
      select 1 from public.users u
      where u.id = p_user
        and (
          (p_audience->>'role' = 'guardian' and coalesce(u.is_guardian, false))
          or (p_audience->>'role' = 'vip' and coalesce(u.is_vip, false))
          or (p_audience->>'role' = 'mvp' and coalesce(u.is_mvp, false))
          or (
            p_audience->>'role' = 'beacon_owner'
            and exists (
              select 1 from public.devices d
              where d.user_id = p_user and d.status is distinct from 'unpaired'
            )
          )
        )
    );

  elsif k = 'inactive' then
    return exists (
      select 1 from public.users u
      where u.id = p_user
        and (
          u.last_seen_at is null
          or u.last_seen_at < now() - make_interval(
               days => greatest(coalesce((p_audience->>'days')::int, 30), 1))
        )
    );
  end if;

  -- Same fail-closed rule as broadcast_recipients.
  return false;
end;
$$;

revoke all on function public.broadcast_recipients(jsonb) from public, anon, authenticated;
revoke all on function public.broadcast_matches(uuid, jsonb) from public, anon, authenticated;
