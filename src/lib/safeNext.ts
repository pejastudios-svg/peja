// Validate a `next` redirect parameter so we never bounce to an external URL,
// a protocol-relative URL, or back into an auth page (which would loop).

const BLOCKED_PREFIXES = ["/login", "/signup", "/auth"];

export function getSafeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/")) return null;
  if (decoded.startsWith("//")) return null;
  if (decoded.startsWith("/\\")) return null;
  if (BLOCKED_PREFIXES.some((p) => decoded === p || decoded.startsWith(p + "/") || decoded.startsWith(p + "?"))) {
    return null;
  }
  return decoded;
}

export function buildLoginHref(next: string | null | undefined, base: "/login" | "/signup" = "/login"): string {
  const safe = getSafeNext(next ?? null);
  if (!safe) return base;
  return `${base}?next=${encodeURIComponent(safe)}`;
}
