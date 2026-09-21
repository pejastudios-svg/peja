-- Moderation refinements for Election Watch.
--
-- 1. Hiding evidence now hides EVERYTHING about it publicly (photo,
--    uploader, polling unit, tally details); what stays toggleable is
--    whether an already-entered tally keeps counting toward totals.
--    tallies_hidden=true (default) pulls the numbers too; false keeps
--    the count while the evidence itself stays withheld.
-- 2. Deletion now exists, admin-only, double-verified in the API layer
--    (admin session AND a fresh admin PIN per destructive call). The
--    append-only posture for VIPs/MVPs is unchanged: no client, tier or
--    route other than the PIN-checked admin actions can remove anything.

alter table public.election_uploads
  add column if not exists tallies_hidden boolean not null default true;
