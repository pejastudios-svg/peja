-- "Start a DM" endpoint with the MVP/VIP gate baked in. Wraps the
-- existing v1 `create_dm_conversation(other_user_id)` RPC behind a
-- permission check so that:
--
--   • Regular users → can't start DMs.
--   • VIPs         → can only DM other VIPs (not MVPs).
--   • MVPs         → can DM MVPs and VIPs.
--   • Admins       → can DM anyone.
--
-- The existing v1 RPC already handles find-or-create atomically;
-- we just gate it. Two reasons we add a NEW function instead of
-- editing the v1 one:
--   1. v1 chat still calls the old RPC and we don't want to start
--      enforcing MVP/VIP rules on legacy code paths until the v1
--      → v2 cutover happens.
--   2. Keeping the gate in a NAMED wrapper makes the policy
--      visible at the call site (`peja_find_or_create_dm`).

create or replace function public.peja_find_or_create_dm(
  other_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  allowed boolean;
  conv_id uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  select public.peja_can_dm(me, other_user_id) into allowed;
  if not allowed then
    raise exception 'Not allowed to message this user'
      using errcode = '42501'; -- insufficient_privilege
  end if;

  -- Delegate to the existing v1 routine which already handles
  -- the find-or-create-two-person-conversation logic atomically.
  select public.create_dm_conversation(other_user_id) into conv_id;
  return conv_id;
end;
$$;

revoke all on function public.peja_find_or_create_dm(uuid) from public;
grant execute on function public.peja_find_or_create_dm(uuid) to authenticated;

comment on function public.peja_find_or_create_dm(uuid) is
  'Permission-gated wrapper around create_dm_conversation. Use this
   instead of the raw RPC from v2 chat so MVP/VIP rules apply.';
