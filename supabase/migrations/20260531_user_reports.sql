-- User report system. Lets users flag bad actors from the chat
-- info sheet or kebab menu, and gives admins an inbox they can
-- review + take action on.
--
-- Existing moderation infra:
--   • users.suspension_reason / ban_reason cover the "admin's
--     reason for the action" requirement.
--   • This migration adds the missing piece: the report row that
--     led the admin to take the action in the first place.
--
-- Reason values are kept as free-form text in the DB but the UI
-- constrains the picker to a small enumerated set ('spam',
-- 'harassment', 'hate', 'explicit', 'impersonation', 'self_harm',
-- 'other'). Keeping it text avoids a migration every time we
-- want to add a category.

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_id uuid not null references public.users(id) on delete cascade,
  -- Optional: when the report originated inside a chat, we link it
  -- so the admin can jump straight to the conversation context.
  conversation_id uuid references public.conversations(id) on delete set null,
  reason text not null,
  -- Free-form context from the reporter ("they keep sending
  -- threatening voice notes" / etc.). Not required.
  notes text,
  -- Lifecycle. Admin moves it from 'pending' to 'dismissed' (no
  -- action) or 'actioned' (suspend/ban/VIP-revoke applied).
  status text not null default 'pending'
    check (status in ('pending', 'dismissed', 'actioned')),
  -- Admin's note on the report itself — separate from the
  -- suspension/ban reason the admin types when taking an account
  -- action. Lets the admin record "duplicate of #1234" or
  -- "warned in app, no further action" without polluting the
  -- user-facing reason field.
  admin_notes text,
  -- Human-readable description of what the admin did, if anything.
  -- e.g. "Suspended for 7 days", "Banned", "VIP revoked".
  action_taken text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Fast lookups for the admin inbox + per-user history pages.
create index if not exists idx_user_reports_reported_id
  on public.user_reports(reported_id);
create index if not exists idx_user_reports_reporter_id
  on public.user_reports(reporter_id);
create index if not exists idx_user_reports_status_created
  on public.user_reports(status, created_at desc);

-- RLS:
--   • Users can INSERT reports where they are the reporter.
--   • Users can SELECT their own reports.
--   • Admin access goes through service-role API routes
--     (requireAdmin) which bypass RLS entirely.
alter table public.user_reports enable row level security;

drop policy if exists "users can submit reports" on public.user_reports;
create policy "users can submit reports"
  on public.user_reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "users can read own reports" on public.user_reports;
create policy "users can read own reports"
  on public.user_reports for select
  to authenticated
  using (reporter_id = auth.uid());

comment on table public.user_reports is
  'User-initiated reports of other users. Admin queue at /admin/reports.';
