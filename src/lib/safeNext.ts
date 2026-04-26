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

  // Strip leading whitespace and zero-width characters some chat clients
  // inject. Reject control chars outright since some browsers normalize
  // them in URLs and they can be used to slip past prefix checks.
  decoded = decoded.replace(/^[\s\u200B-\u200D\uFEFF]+/, "");
  if (/[\x00-\x1f\x7f]/.test(decoded)) return null;

  // Backslashes get normalized to forward slashes in some URL parsers, so
  // `/\\evil.com` would become `//evil.com` — block any backslash entirely.
  if (decoded.includes("\\")) return null;

  if (!decoded.startsWith("/")) return null;
  if (decoded.startsWith("//")) return null;

  if (
    BLOCKED_PREFIXES.some(
      (p) => decoded === p || decoded.startsWith(p + "/") || decoded.startsWith(p + "?")
    )
  ) {
    return null;
  }

  return decoded;
}

export function buildLoginHref(next: string | null | undefined, base: "/login" | "/signup" = "/login"): string {
  const safe = getSafeNext(next ?? null);
  if (!safe) return base;
  return `${base}?next=${encodeURIComponent(safe)}`;
}
