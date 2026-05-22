-- DB-layer enforcement of the MVP / VIP visibility rules.
--
-- Backstory: the UI gates won't be enough on their own — a curious
-- user could call supabase.from('users').select('...') directly and
-- bypass them. Rather than locking down the whole `users` table
-- with RLS (which would break a lot of existing app code that
-- reads basic user info for posts, comments, etc.), we expose a
-- SECURITY DEFINER function that returns ONLY the elevated users
-- the caller is allowed to see, given their own role.
--
-- Use this RPC from every "find another MVP/VIP to message,
-- forward to, or add to a group" surface. Clients should NOT
-- query users.is_vip / is_mvp directly for these flows.
--
-- Rules implemented here (matches project_mvp_vip_roles note):
--   • regular user → empty result
--   • VIP          → all OTHER VIPs (excludes MVPs and self)
--   • MVP          → all OTHER MVPs + VIPs (excludes self)
--   • admin        → all MVPs + VIPs (excludes self)
--
-- Suspended / banned users are filtered out so they don't surface
-- as targets for new DMs.

create or replace function public.peja_visible_elevated_users(
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
           u.full_name,
           u.avatar_url,
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
           u.full_name,
           u.avatar_url,
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
           u.full_name,
           u.avatar_url,
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

  -- Regular users see no one through this picker — they can't DM
  -- new people at all in the MVP/VIP model. Return empty.
  return;
end;
$$;

revoke all on function public.peja_visible_elevated_users(uuid) from public;
grant execute on function public.peja_visible_elevated_users(uuid) to authenticated;

comment on function public.peja_visible_elevated_users(uuid) is
  'Visibility-rule-enforced list of MVP/VIP users the caller can see.
   See project_mvp_vip_roles memory note for the product spec. Use
   this RPC from every "find elevated user" surface — direct
   users-table reads bypass the rule.';

-- ---------------------------------------------------------------
-- Server-side gate for "can A DM B?" used by future new-DM API
-- routes. Returns true only when:
--   • A is admin (always allowed), OR
--   • A is MVP and B is MVP/VIP, OR
--   • A is VIP and B is VIP (not MVP).
-- Regular users can never start a new DM.
-- ---------------------------------------------------------------
create or replace function public.peja_can_dm(
  from_user_id uuid,
  to_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a_vip boolean;
  a_mvp boolean;
  a_admin boolean;
  b_vip boolean;
  b_mvp boolean;
begin
  if from_user_id = to_user_id then
    return false;
  end if;

  select coalesce(is_vip, false),
         coalesce(is_mvp, false),
         coalesce(is_admin, false)
    into a_vip, a_mvp, a_admin
  from public.users where id = from_user_id;

  select coalesce(is_vip, false),
         coalesce(is_mvp, false)
    into b_vip, b_mvp
  from public.users where id = to_user_id;

  if a_admin then return true; end if;
  if a_mvp and (b_vip or b_mvp) then return true; end if;
  if a_vip and b_vip and not b_mvp then return true; end if;
  return false;
end;
$$;

revoke all on function public.peja_can_dm(uuid, uuid) from public;
grant execute on function public.peja_can_dm(uuid, uuid) to authenticated;

comment on function public.peja_can_dm(uuid, uuid) is
  'Server-side enforcement of MVP/VIP DM permissions. Future
   start-DM API routes call this BEFORE creating a conversation.';
