-- Paying for an advert.
--
-- Card on file, charged by our own cron, rather than Paystack
-- Subscriptions. The schedule has to be ours because too much already
-- moves it: an outage credit pushes the renewal out by the days lost, a
-- pause stops the clock entirely, and a mid-term cancellation refunds a
-- part of what was taken. Paystack can be told to shift a subscription
-- date, but it is the wrong shape for a schedule that changes this
-- often, and reconciling two sources of truth about when somebody is due
-- to pay is how people get double charged.
--
-- So: Paystack holds the card and moves the money, we decide when.

-- =====================================================================
-- Where an unpaid advert waits
-- =====================================================================
-- Payment comes before review, not after. An advert nobody has paid for
-- should never reach the review queue, because reviewing it is the
-- expensive part and it is wasted on somebody who abandoned a checkout.
-- The 24 hour cancellation window runs from this point.
alter table public.ad_placements drop constraint if exists ad_placements_status_check;
alter table public.ad_placements add constraint ad_placements_status_check check (
  status in (
    'awaiting_payment',
    'pending', 'approved', 'live', 'paused',
    'expired', 'rejected', 'cancelled'
  )
);

-- =====================================================================
-- The card
-- =====================================================================
-- Held against the business rather than the placement, so a second
-- advert from the same advertiser does not ask for the card again.
--
-- Only ever the authorization code and the last four. Paystack holds the
-- card; storing anything more would put us in scope for requirements we
-- have no reason to be in scope for.
alter table public.advertisers
  add column if not exists paystack_customer_code text,
  add column if not exists paystack_authorization_code text,
  add column if not exists card_last4 text,
  add column if not exists card_brand text,
  add column if not exists card_exp text;

-- =====================================================================
-- Every movement of money
-- =====================================================================
-- Append-only in practice: a failed charge is a row, a retry is another
-- row, a refund is a row with a negative amount. Nothing is updated in
-- place except the status of a transaction we are still waiting on.
--
-- This table is the answer to "what did this advertiser actually pay",
-- which is a question that gets asked in anger, so it has to be
-- reconstructable without reading Paystack's dashboard.
create table if not exists public.ad_payments (
  id uuid primary key default gen_random_uuid(),

  placement_id uuid references public.ad_placements(id) on delete set null,
  advertiser_id uuid not null references public.advertisers(id) on delete cascade,

  -- Kobo, because that is the unit Paystack takes and converting at the
  -- boundary twice is how rounding errors get into invoices. Negative
  -- for a refund.
  amount_kobo bigint not null,

  kind text not null check (kind in ('initial', 'renewal', 'deposit', 'refund')),

  status text not null default 'pending'
    check (status in ('pending', 'success', 'failed', 'abandoned', 'refunded')),

  -- Our reference, sent to Paystack and echoed back on the webhook. The
  -- unique constraint is what makes webhook delivery idempotent: Paystack
  -- retries, and a retry must not charge or credit anything twice.
  reference text not null unique,
  paystack_id bigint,
  authorization_code text,

  -- Whatever Paystack said when it declined. Shown to the advertiser,
  -- because "your payment failed" with no reason just generates a
  -- support ticket.
  failure_reason text,

  -- The full gateway response, for the argument that happens six months
  -- later. Never read by application code.
  raw jsonb,

  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ad_payments_advertiser_idx on public.ad_payments (advertiser_id, created_at desc);
create index if not exists ad_payments_placement_idx on public.ad_payments (placement_id, created_at desc);
-- The revenue board sums successful payments by month.
create index if not exists ad_payments_settled_idx on public.ad_payments (paid_at desc)
  where status in ('success', 'refunded');

-- The billing cron's only query: what is due right now. Partial, so it
-- stays small no matter how many expired placements accumulate.
create index if not exists ad_placements_due_idx on public.ad_placements (next_charge_at)
  where status = 'live' and auto_renew = true;

-- Abandoned checkouts, swept by the same cron.
create index if not exists ad_placements_unpaid_idx on public.ad_placements (created_at)
  where status = 'awaiting_payment';

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.ad_payments enable row level security;

-- An advertiser can read their own receipts. Nobody writes through the
-- client: every row here is created by a service-role route, because the
-- amount is decided on the server and a client that can insert payment
-- rows can mark itself paid.
drop policy if exists ad_payments_owner_read on public.ad_payments;
create policy ad_payments_owner_read on public.ad_payments
  for select using (
    advertiser_id in (
      select id from public.advertisers where owner_user_id = auth.uid()
    )
  );
