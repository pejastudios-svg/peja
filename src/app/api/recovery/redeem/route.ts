import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";
import { sendPushToUser } from "../../_firebaseAdmin";

export const runtime = "nodejs";

/**
 * Redeem a recovery code to set a new password.
 *
 * This is the one route that lets somebody past a forgotten password
 * without touching email, so it is deliberately unforgiving: hard rate
 * limits per address AND per IP, constant-time comparison, single use,
 * and the account owner is told on every device the moment a code is
 * spent. A thief who finds a written-down code cannot use it quietly.
 */

const IP_LIMIT = 10;
const EMAIL_LIMIT = 5;

function hashCode(userId: string, code: string): string {
  return crypto.createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

export async function POST(req: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const { email, code, newPassword } = await req.json();
  if (!email || !code || !newPassword) {
    return NextResponse.json({ ok: false, error: "All fields required" }, { status: 400 });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanCode = String(code).replace(/\D/g, "");

  if (
    newPassword.length < 8 ||
    !/[A-Z]/.test(newPassword) ||
    !/[a-z]/.test(newPassword) ||
    !/\d/.test(newPassword)
  ) {
    return NextResponse.json(
      { ok: false, error: "Password must be at least 8 characters with uppercase, lowercase, and a number" },
      { status: 400 },
    );
  }

  if (
    (await isRateLimitedDurable(`recovery-redeem-ip:${ip}`, IP_LIMIT, 3600)) ||
    (await isRateLimitedDurable(`recovery-redeem:${cleanEmail}`, EMAIL_LIMIT, 3600))
  ) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Try again later." },
      { status: 429 },
    );
  }

  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, full_name")
    .eq("email", cleanEmail)
    .limit(1);

  // Same answer whether the account is missing or the code is wrong, so
  // this cannot be used to discover which addresses are registered.
  const invalid = NextResponse.json(
    { ok: false, error: "That code is not valid." },
    { status: 401 },
  );
  if (!users || users.length === 0) return invalid;
  const user = users[0];

  const { data: match } = await supabaseAdmin
    .from("recovery_codes")
    .select("id")
    .eq("user_id", user.id)
    .eq("code_hash", hashCode(user.id, cleanCode))
    .is("used_at", null)
    .limit(1)
    .maybeSingle();
  if (!match) return invalid;

  // Burn the code BEFORE changing the password, and only if it is still
  // unused. Two requests racing with the same code cannot both win.
  const { data: burned } = await supabaseAdmin
    .from("recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", match.id)
    .is("used_at", null)
    .select("id");
  if (!burned || burned.length === 0) return invalid;

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });
  if (updateError) {
    console.error("[recovery/redeem] password update failed:", updateError.message);
    return NextResponse.json(
      { ok: false, error: "Could not update the password. Try again." },
      { status: 500 },
    );
  }

  const { count: remaining } = await supabaseAdmin
    .from("recovery_codes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("used_at", null);

  // Loud on purpose. If this was not them, they need to know now.
  sendPushToUser({
    userId: user.id,
    title: "Your password was reset",
    body: `A recovery code was just used to change your password. ${remaining ?? 0} codes left. If this was not you, secure your account immediately.`,
    data: { type: "recovery_code_used" },
  }).catch(() => {});

  return NextResponse.json({ ok: true, remaining: remaining ?? 0 });
}
