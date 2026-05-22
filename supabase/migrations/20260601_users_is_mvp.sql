-- Add the MVP role tier alongside the existing VIP tier.
--
-- Privilege model (see project_mvp_vip_roles memory note for the
-- product context):
--
--   • regular user → cannot DM anyone, cannot see the message
--     button, cannot forward incidents into chats.
--   • VIP          → can DM, can be DMed, can forward incidents.
--                    Cannot see other MVPs in any people-picker.
--   • MVP          → all VIP capabilities PLUS:
--                    – visible to other MVPs in pickers
--                    – can see both MVPs and VIPs in pickers
--   • peja account → only account that can create group chats
--                    (orthogonal to MVP/VIP).
--
-- Schema choice: a separate boolean rather than turning is_vip into
-- an enum keeps all existing RLS / app code that reads `is_vip`
-- working unchanged. New code adds `is_mvp` checks on top where
-- needed, and "has elevated access" becomes `is_mvp OR is_vip`.

alter table public.users
  add column if not exists is_mvp boolean not null default false;

create index if not exists idx_users_is_mvp
  on public.users(is_mvp) where is_mvp = true;

comment on column public.users.is_mvp is
  'MVP role tier — strictly higher than VIP. MVPs see MVPs + VIPs; VIPs see only VIPs. See project_mvp_vip_roles memory note.';
