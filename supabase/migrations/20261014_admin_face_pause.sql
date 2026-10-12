-- Pause face verification on the admin gate, without revoking anything.
--
-- Until now the only way to stop the face phase running was to revoke
-- the enrolment, which deletes it: re-enabling meant generating a fresh
-- enrolment link and standing in front of a camera again. That is far
-- too heavy for "my camera is broken" or "I am on a borrowed laptop",
-- and the predictable result is that somebody revokes in a hurry and
-- never re-enrols, leaving the dashboard permanently weaker.
--
-- A pause keeps the enrolment intact and flips one flag.
--
-- The asymmetry is deliberate and is enforced in the API, not here:
-- pausing requires the PIN again, because that is the direction that
-- removes protection. Resuming requires nothing, because nobody should
-- ever be discouraged from turning security back on.
alter table public.users
  add column if not exists admin_face_paused boolean not null default false;

comment on column public.users.admin_face_paused is
  'Admin chose to skip face verification at the gate. Enrolments are untouched.';
