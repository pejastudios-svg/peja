// Centralised "is this the peja super-admin?" check. Single point of
// change if we ever migrate to a dedicated is_super_admin flag (which
// would mean updating both this and the matching SQL helper —
// public.peja_is_super_admin). Until then, identity is keyed on the
// canonical email.

const PEJA_EMAIL = "pejastudios@gmail.com";

export function isPejaUser(user: { email?: string | null } | null | undefined): boolean {
  if (!user?.email) return false;
  return user.email.trim().toLowerCase() === PEJA_EMAIL;
}
