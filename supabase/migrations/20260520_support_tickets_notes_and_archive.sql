-- Follow-up to 20260518_support_tickets.sql and 20260519_support_tickets_admin_policy.sql
-- Adds:
--   * admin_notes JSONB array — history of internal notes + replies sent.
--     Each entry: { id, kind: 'note' | 'reply', body, author_id, created_at }
--   * 'archived' to the status enum so admins can shelve tickets without
--     deleting them.
-- Also migrates any existing admin_response value into the new notes array
-- (one-time backfill) so nothing is lost.

alter table public.support_tickets
  add column if not exists admin_notes jsonb not null default '[]'::jsonb;

-- Replace the status check to include 'archived'.
alter table public.support_tickets
  drop constraint if exists support_tickets_status_check;
alter table public.support_tickets
  add constraint support_tickets_status_check
  check (status in ('open', 'in_progress', 'resolved', 'archived'));

-- One-time backfill: existing admin_response rows -> first entry of admin_notes.
update public.support_tickets
   set admin_notes = jsonb_build_array(
       jsonb_build_object(
         'id', gen_random_uuid()::text,
         'kind', 'note',
         'body', admin_response,
         'author_id', resolved_by,
         'created_at', to_char(coalesce(updated_at, created_at) at time zone 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
   )
 where admin_response is not null
   and admin_response <> ''
   and admin_notes = '[]'::jsonb;
