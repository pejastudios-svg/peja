-- Lockout help requests ride on the existing support_tickets table.
--
-- Someone who is locked out has no recovery codes and no reachable
-- contacts, so there is no automated route left for them. They file a
-- ticket, a human reads it, and the admin issues a temporary password.
--
-- Reusing support_tickets rather than building a parallel queue means the
-- whole admin triage UI already works: statuses, notes, archive, search.
-- The only thing missing was knowing WHAT KIND of problem a ticket is, so
-- the admin screen can show the right handling steps beside it.

-- Nullable on purpose. Every ticket filed before now has no category, and
-- ordinary support tickets from the Help screen still will not.
alter table public.support_tickets
  add column if not exists category text;

comment on column public.support_tickets.category is
  'Recovery lockout category (no_codes, lost_codes, no_contacts, contacts_unreachable, lost_email, other). Null for ordinary support tickets.';

-- Recovery tickets are the ones worth finding fast, and they are a small
-- slice of the table, so a partial index keeps this cheap.
create index if not exists support_tickets_category_idx
  on public.support_tickets (category, created_at desc)
  where category is not null;
