-- Who actually filed a recovery ticket.
--
-- The lockout form at /forgot-password is necessarily anonymous: the whole
-- point is that the person cannot sign in. The ticket is then filed
-- AGAINST the account whose email was typed in, so the admin can find it.
--
-- That creates a real trap. A ticket filed by a stranger against someone
-- else's account looks identical, in the admin queue, to one the account
-- holder filed themselves. Nothing on screen says "nobody has proved they
-- are this person", so an admin reading quickly could treat an attacker's
-- story as the owner's.
--
-- It is not an account-takeover hole: the temporary password goes to the
-- address already on the account, so a stranger filing one only causes the
-- real owner to be emailed and pushed a warning. It is a judgement hole,
-- and the fix is to make the queue state plainly what is and is not known.

-- True for anything filed from the signed-out form. Ordinary tickets from
-- the in-app Help screen come from a logged-in session and stay false.
alter table public.support_tickets
  add column if not exists unverified_requester boolean not null default false;

-- A number the filer offers for a callback. Attacker-supplied like
-- everything else on that form, and worthless on its own. Its value is in
-- the COMPARISON: a number matching the one on the account is real signal,
-- and one that does not match is a red flag worth slowing down for.
alter table public.support_tickets
  add column if not exists requester_phone text;

-- For spotting someone filing against many accounts. Not shown as
-- identity, only as a pattern.
alter table public.support_tickets
  add column if not exists requester_ip text;

comment on column public.support_tickets.unverified_requester is
  'Filed from the signed-out recovery form. Nobody has proved they hold this account.';
comment on column public.support_tickets.requester_phone is
  'Callback number the filer typed. Untrusted; useful only compared to the phone on the account.';

-- The name the filer typed. Same status as the phone: attacker-supplied,
-- worthless alone, useful compared to the name on the account. Two weak
-- checks that must BOTH line up are a good deal harder to fake than one,
-- and someone who knows an email address usually does not know the exact
-- name the account was registered with.
alter table public.support_tickets
  add column if not exists requester_name text;

comment on column public.support_tickets.requester_name is
  'Full name the filer typed. Untrusted; useful only compared to full_name on the account.';
