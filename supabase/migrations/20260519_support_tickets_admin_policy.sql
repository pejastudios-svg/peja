-- Follow-up to 20260518_support_tickets.sql
-- Admin policies: allow admin users (public.users.is_admin = true) to read and
-- update every ticket. Without these, the /admin/support page's client-side
-- fetch only ever returns the admin's own tickets and admin note edits via the
-- client would also be blocked.

drop policy if exists "admins read all support tickets" on public.support_tickets;
create policy "admins read all support tickets"
  on public.support_tickets for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.is_admin = true
    )
  );

drop policy if exists "admins update all support tickets" on public.support_tickets;
create policy "admins update all support tickets"
  on public.support_tickets for update
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.is_admin = true
    )
  );
