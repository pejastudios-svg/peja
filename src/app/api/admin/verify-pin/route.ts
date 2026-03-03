// src/app/api/admin/verify-pin/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import {
  verifyPin,
  createSessionToken,
  ADMIN_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/adminSession";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const ua = req.headers.get("user-agent") || "unknown";
  const supabaseAdmin = getSupabaseAdmin();

  // ── authenticate caller ──
  let userId: string | null = null;
  let userEmail: string | null = null;

  try {
    const { user } = await requireAdmin(req); // checks Supabase token + is_admin
    userId = user.id;
    userEmail = user.email ?? null;
  } catch {
    // log unauthenticated attempt
    await supabaseAdmin.from("admin_access_log").insert({
      action: "auth_failed",
      ip_address: ip,
      user_agent: ua,
      metadata: { reason: "requireAdmin failed" },
    });
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // ── server-side rate limit ──
  const fiveMin = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count: recent } = await supabaseAdmin
    .from("admin_access_log")
    .select("*", { count: "exact", head: true })
    .eq("action", "pin_failed")
    .gte("created_at", fiveMin);

  const fails = recent || 0;

  if (fails >= 10) {
    return NextResponse.json(
      { ok: false, error: "Locked — too many attempts", locked: true, lockout_minutes: 60 },
      { status: 429 }
    );
  }
  if (fails >= 5) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts — wait 5 min", locked: true, lockout_minutes: 5 },
      { status: 429 }
    );
  }

  // ── validate PIN ──
  const { pin } = await req.json();
  if (!pin || typeof pin !== "string") {
    return NextResponse.json({ ok: false, error: "PIN required" }, { status: 400 });
  }

  const storedHash = process.env.ADMIN_PIN_HASH;
  if (!storedHash) {
    return NextResponse.json({ ok: false, error: "Server mis-configured" }, { status: 500 });
  }

  const valid = verifyPin(pin, storedHash);

  // log attempt
  await supabaseAdmin.from("admin_access_log").insert({
    user_id: userId,
    action: valid ? "pin_success" : "pin_failed",
    ip_address: ip,
    user_agent: ua,
    metadata: { email: userEmail },
  });

  if (!valid) {
    const remaining = Math.max(0, 5 - (fails + 1));
    return NextResponse.json(
      { ok: false, error: "Incorrect PIN", attempts_remaining: remaining, should_capture: true },
      { status: 401 }
    );
  }

  // ── success → set httpOnly cookie ──
  const token = createSessionToken();
  const res = NextResponse.json({ ok: true });

  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return res;
}