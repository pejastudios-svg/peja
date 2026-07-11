// src/app/api/_auth.ts
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "./_supabaseAdmin";
import { verifySessionToken, ADMIN_COOKIE_NAME } from "@/lib/adminSession";

// Minimal shape callers depend on. Only `id` and `user.email` are
// actually read across the api/ routes today — see grep before
// widening. Kept compatible-ish with supabase-js's User type so
// existing call sites need no changes.
export type AuthUser = {
  id: string;
  email?: string;
};

// Machine-readable auth failure codes. Clients key retry behavior off
// these (token_expired → refresh the session and retry once) instead
// of string-matching error prose.
export type AuthErrorCode = "missing_token" | "token_expired" | "invalid_token";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status = 401;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

/**
 * Maps an AuthError to a 401 JSON response, or null if the error is
 * not auth-related (caller falls through to its own 500 handling).
 *
 * Usage in a route's catch:
 *   return authErrorResponse(error)
 *     ?? NextResponse.json({ error: error.message }, { status: 500 });
 */
export function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return null;
}

// Cache the encoded secret across invocations. With Fluid Compute the
// module is reused between requests, so this is effectively a process
// constant once warmed.
let cachedSecret: Uint8Array | null = null;
function getJwtSecret(): Uint8Array | null {
  if (cachedSecret) return cachedSecret;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  cachedSecret = new TextEncoder().encode(secret);
  return cachedSecret;
}

// Network verify via the Supabase admin client. Used when no local
// secret is configured, and as a fallback when local verification
// fails for a reason other than expiry (secret rotation, a migration
// to asymmetric signing keys) so a stale env var degrades to slow
// auth instead of a total outage.
async function networkVerify(token: string): Promise<{ user: AuthUser }> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    throw new AuthError("invalid_token", "Invalid user");
  }
  return { user: { id: data.user.id, email: data.user.email } };
}

export async function requireUser(req: NextRequest): Promise<{ user: AuthUser }> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) throw new AuthError("missing_token", "Missing Authorization token");

  // Fast path: verify the JWT locally with the project's JWT secret.
  // Supabase signs auth tokens with HS256 + the JWT secret from
  // Dashboard → Settings → API. Local verify is ~1ms; the network
  // round-trip to GoTrue was measured at 2-3s on this environment.
  // If SUPABASE_JWT_SECRET isn't set the fast path skips and we fall
  // through to the network verify, so the file is safe to ship before
  // the env var is provisioned.
  const secret = getJwtSecret();
  if (secret) {
    try {
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
        clockTolerance: 10,
      });
      const sub = typeof payload.sub === "string" ? payload.sub : null;
      if (!sub) throw new AuthError("invalid_token", "Invalid user");
      const email =
        typeof payload.email === "string" ? payload.email : undefined;
      return { user: { id: sub, email } };
    } catch (err: unknown) {
      if (err instanceof AuthError) throw err;
      // Expiry is authoritative — the token was validly signed but is
      // stale. Tell the client so it refreshes and retries instead of
      // treating it as a hard failure.
      if ((err as { code?: string })?.code === "ERR_JWT_EXPIRED") {
        throw new AuthError("token_expired", "Session expired");
      }
      // Signature/algorithm mismatch: the local secret may be stale
      // (rotated, or the project moved to new signing keys). GoTrue is
      // the source of truth — fall back to network verify rather than
      // rejecting every user.
      return networkVerify(token);
    }
  }

  return networkVerify(token);
}

// DB-only admin check (used by verify-pin — before cookie exists)
export async function requireAdmin(req: NextRequest) {
  const { user } = await requireUser(req);
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (error || !data?.is_admin) throw new Error("Admin required");
  return { user };
}

// Full admin check: Supabase auth + DB is_admin + PIN session cookie
// ➜ Use this for ALL admin API routes (except verify-pin itself)
export async function requireAdminSession(req: NextRequest) {
  const { user } = await requireAdmin(req);

  const cookie = req.cookies.get(ADMIN_COOKIE_NAME);
  if (!cookie?.value || !verifySessionToken(cookie.value)) {
    throw new Error("Admin PIN session expired. Re-enter PIN");
  }

  return { user };
}
