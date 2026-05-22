-- Fix for "structure of query does not match function result type"
-- when calling peja_visible_elevated_users.
--
-- Two problems we're fixing:
--
--   1. Postgres won't let CREATE OR REPLACE FUNCTION change a return
--      type. If an earlier draft of 20260602 was applied with a
--      different RETURNS TABLE shape (or different column order),
--      every re-run of CREATE OR REPLACE silently kept the old
--      signature — so the SELECT inside the body no longer matched
--      the declared return columns. We DROP first, then recreate.
--
--   2. public.users.full_name / avatar_url are character varying in
--      the real DB (legacy schema), not text. Postgres treats those
--      as distinct types for RETURNS TABLE strictness, so the column
--      list has to cast each one explicitly. The original migration
--      relied on implicit assignability and that's what produced the
--      "structure ... does not match" error on call.

drop function if exists public.peja_visible_elevated_users(uuid);

create function public.peja_visible_elevated_users(
  viewer_id uuid
)
returns table (
  id uuid,
  full_name text,
  avatar_url text,
  is_vip boolean,
  is_mvp boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_vip boolean;
  v_is_mvp boolean;
  v_is_admin boolean;
begin
  select coalesce(u.is_vip, false),
         coalesce(u.is_mvp, false),
         coalesce(u.is_admin, false)
    into v_is_vip, v_is_mvp, v_is_admin
  from public.users u
  where u.id = viewer_id;

  -- Admin: sees everyone elevated. Useful for moderation views.
  if v_is_admin then
    return query
    select u.id,
           u.full_name::text,
           u.avatar_url::text,
           coalesce(u.is_vip, false),
           coalesce(u.is_mvp, false)
    from public.users u
    where (coalesce(u.is_vip, false) = true
        or coalesce(u.is_mvp, false) = true)
      and u.id <> viewer_id
      and (u.status is null or u.status = 'active')
    order by u.full_name;
    return;
  end if;

  -- MVP: sees MVPs + VIPs.
  if v_is_mvp then
    return query
    select u.id,
           u.full_name::text,
           u.avatar_url::text,
           coalesce(u.is_vip, false),
           coalesce(u.is_mvp, false)
    from public.users u
    where (coalesce(u.is_vip, false) = true
        or coalesce(u.is_mvp, false) = true)
      and u.id <> viewer_id
      and (u.status is null or u.status = 'active')
    order by u.full_name;
    return;
  end if;

  -- VIP: sees other VIPs ONLY (not MVPs).
  if v_is_vip then
    return query
    select u.id,
           u.full_name::text,
           u.avatar_url::text,
           coalesce(u.is_vip, false),
           false as is_mvp
    from public.users u
    where coalesce(u.is_vip, false) = true
      and coalesce(u.is_mvp, false) = false
      and u.id <> viewer_id
      and (u.status is null or u.status = 'active')
    order by u.full_name;
    return;
  end if;

  -- Regular users see no one through this picker.
  return;
end;
$$;

revoke all on function public.peja_visible_elevated_users(uuid) from public;
grant execute on function public.peja_visible_elevated_users(uuid) to authenticated;
