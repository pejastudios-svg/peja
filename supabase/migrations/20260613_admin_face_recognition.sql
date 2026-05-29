-- Face recognition as a second factor for admin login. Slots between
-- the existing PIN gate and TOTP. Two tables:
--
--   1. admin_face_enrollments — one row per enrolled face. An admin user
--      may have several rows (e.g. "work laptop" and "phone front-cam"),
--      each storing a 128-float face descriptor produced by face-api.
--      Verification computes the live descriptor and matches it against
--      every non-revoked enrollment for that user by Euclidean distance.
--
--   2. admin_face_enrollment_tokens — single-use invitation URLs that an
--      existing admin issues for another admin to enroll. The enrollment
--      page is public (no PIN required by design — that's the point of
--      the link), so the token must be validated and burned server-side.
--
-- Access pattern: both tables are touched only by server routes using
-- the service-role key (getSupabaseAdmin). RLS is enabled with no
-- policies, which denies all client traffic while letting the service
-- role through. Same pattern as the existing admin_totp table.
--
-- Audit logging reuses the existing admin_access_log table — new
-- actions: face_enrolled, face_enrollment_link_created,
-- face_enrollment_link_used, face_verify_success, face_verify_fail,
-- face_revoked.

-- 1. Enrolled face descriptors.
create table if not exists public.admin_face_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  descriptor jsonb not null,
  thumbnail_url text,
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null
);

-- Verify path queries by user_id and only wants active rows — partial
-- index keeps it small and skips the revoked tombstones.
create index if not exists admin_face_enrollments_user_active_idx
  on public.admin_face_enrollments (user_id)
  where revoked_at is null;

-- 2. Enrollment invitation tokens. The primary key IS the token, which
-- is a 32-byte random base64url string generated server-side. We never
-- need to look up by id, so this avoids carrying a separate column.
create table if not exists public.admin_face_enrollment_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  label_hint text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_enrollment_id uuid references public.admin_face_enrollments(id) on delete set null,
  revoked_at timestamptz
);

-- Used for the "pending tokens for this user" panel on the security
-- page. Filters down to invitations that are still actionable.
create index if not exists admin_face_enrollment_tokens_pending_idx
  on public.admin_face_enrollment_tokens (user_id, expires_at)
  where used_at is null and revoked_at is null;

-- 3. Lock down both tables. Service role bypasses RLS; everything else
-- is denied because we've enabled RLS without writing any policies.
alter table public.admin_face_enrollments enable row level security;
alter table public.admin_face_enrollment_tokens enable row level security;

-- Belt-and-suspenders: explicitly revoke direct access from the
-- standard Supabase roles so a future "add a permissive policy"
-- mistake can't accidentally expose descriptors.
revoke all on public.admin_face_enrollments from anon, authenticated;
revoke all on public.admin_face_enrollment_tokens from anon, authenticated;
