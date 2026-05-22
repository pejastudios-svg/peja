// src/app/api/_auth.ts
import { NextRequest } from "next/server";
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

export async function requireUser(req: NextRequest): Promise<{ user: AuthUser }> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) throw new Error("Missing Authorization token");

  // Fast path: verify the JWT locally with the project's JWT secret.
  // Supabase signs auth tokens with HS256 + the JWT secret from
  // Dashboard → Settings → API. Local verify is ~1ms; the network
  // round-trip to GoTrue was measured at 2-3s on this environment.
  // If SUPABASE_JWT_SECRET isn't set the fast path skips and we fall
  // through to the legacy network verify, so the file is safe to
  // ship before the env var is provisioned.
  const secret = getJwtSecret();
  if (secret) {
    try {
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
      });
      const sub = typeof payload.sub === "string" ? payload.sub : null;
      if (!sub) throw new Error("Invalid user");
      const email =
        typeof payload.email === "string" ? payload.email : undefined;
      return { user: { id: sub, email } };
    } catch {
      // Signature invalid, token expired, wrong algorithm, etc.
      throw new Error("Invalid user");
    }
  }

  // Slow-path fallback: network verify via Supabase admin client.
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) throw new Error("Invalid user");

  return { user: { id: data.user.id, email: data.user.email } };
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