-- Support tickets / contact-us submissions.
-- Created by the user from the Help & Support page and surfaced to admins via /admin/support.

create extension if not exists "pgcrypto";

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  admin_response text,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_id_idx on public.support_tickets (user_id);
create index if not exists support_tickets_status_idx on public.support_tickets (status);
create index if not exists support_tickets_created_at_idx on public.support_tickets (created_at desc);

-- Auto-bump updated_at on row changes.
create or replace function public.support_tickets_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.support_tickets_set_updated_at();

-- Row-level security: users can read/insert their own tickets. Admins (handled
-- via service role in API routes) bypass RLS, so no explicit admin policy is
-- needed here.
alter table public.support_tickets enable row level security;

drop policy if exists "users read own support tickets" on public.support_tickets;
create policy "users read own support tickets"
  on public.support_tickets for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own support tickets" on public.support_tickets;
create policy "users insert own support tickets"
  on public.support_tickets for insert
  with check (auth.uid() = user_id);
