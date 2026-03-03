// src/app/api/_auth.ts
import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "./_supabaseAdmin";
import { verifySessionToken, ADMIN_COOKIE_NAME } from "@/lib/adminSession";

export async function requireUser(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) throw new Error("Missing Authorization token");

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) throw new Error("Invalid user");

  return { user: data.user };
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
    throw new Error("Admin PIN session expired — re-enter PIN");
  }

  return { user };
}