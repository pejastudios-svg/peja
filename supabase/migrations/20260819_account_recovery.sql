-- Account recovery without email.
--
-- Peja's whole email path runs on one consumer Gmail quota, which makes
-- "we sent you a reset link" both expensive and fragile. It is also the
-- weakest link in the account: whoever owns the inbox owns everything
-- attached to it.
--
-- Three routes replace it, strongest first:
--   1. passkeys          nothing to reset, the phone proves you
--   2. trusted contacts  two people who already vouched for you say yes
--   3. recovery codes    twenty one-time codes you saved yourself
--
-- Route 2 is the one most apps cannot offer. Peja already holds a graph
-- of mutually accepted emergency contacts, so it can ask humans who
-- genuinely know this person instead of trusting whoever holds an inbox.

-- ── 1. Passkeys (WebAuthn) ─────────────────────────────────────────────
create table if not exists public.user_passkeys (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  credential_id  text not null unique,      -- base64url, from the authenticator
  public_key     text not null,             -- base64url COSE key
  counter        bigint not null default 0, -- replay guard; must never go backwards
  transports     text[],
  device_label   text,                      -- "Ada's iPhone", for the revoke list
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz
);
create index if not exists user_passkeys_user_idx on public.user_passkeys (user_id);

-- Short-lived challenges. WebAuthn requires the server to issue a nonce
-- and verify the signature came back over that exact value.
create table if not exists public.webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete cascade,
  email       text,                          -- login, before we know the user
  challenge   text not null,
  purpose     text not null check (purpose in ('register', 'authenticate')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists webauthn_challenges_expiry_idx on public.webauthn_challenges (expires_at);

-- ── 2. Recovery codes ──────────────────────────────────────────────────
-- Hashed, never stored in the clear. That is not just hygiene: it makes
-- "we can only show these once" a property of the system rather than a
-- promise, because the server genuinely cannot recover them.
create table if not exists public.recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  code_hash   text not null,
  batch_id    uuid not null,                -- regenerating retires a whole batch
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists recovery_codes_user_idx on public.recovery_codes (user_id, used_at);

-- ── 3. Trusted contact recovery ────────────────────────────────────────
create table if not exists public.recovery_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'unlocked', 'cancelled', 'expired')),
  -- Set once enough approvals land. Access does NOT open until this
  -- passes: the owner is alerted the moment recovery starts and gets a
  -- visible countdown to kill it. Costs an impatient user ten minutes
  -- and costs an imposter the whole attempt.
  unlock_at     timestamptz,
  approvals_required smallint not null default 2,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '1 hour'),
  cancelled_at  timestamptz,
  cancelled_by  uuid references public.users(id) on delete set null
);
create index if not exists recovery_requests_user_idx on public.recovery_requests (user_id, status);

-- Who the user chose to ask. Written when the request is created, so the
-- set of approvers cannot be widened after the fact.
create table if not exists public.recovery_approvers (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.recovery_requests(id) on delete cascade,
  contact_user_id uuid not null references public.users(id) on delete cascade,
  responded_at timestamptz,
  approved     boolean,
  unique (request_id, contact_user_id)
);
create index if not exists recovery_approvers_request_idx on public.recovery_approvers (request_id);

-- Service-role only across the board. Every one of these tables is a way
-- into somebody's account; none of it belongs in client reach.
alter table public.user_passkeys       enable row level security;
alter table public.webauthn_challenges enable row level security;
alter table public.recovery_codes      enable row level security;
alter table public.recovery_requests   enable row level security;
alter table public.recovery_approvers  enable row level security;

comment on table public.recovery_codes is
  'Hashed one-time account recovery codes. Shown once at generation and unrecoverable afterwards by design.';
comment on table public.recovery_requests is
  'Trusted-contact account recovery. Needs approvals_required approvals, then a delay before access opens.';
