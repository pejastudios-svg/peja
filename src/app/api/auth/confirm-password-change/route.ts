// src/app/api/auth/confirm-password-change/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();

  let userId: string;
  // Needed by the same-password probe below.
  let userEmail: string;

  try {
    const { user } = await requireUser(req);
    userId = user.id;
    userEmail = user.email || "";
  } catch {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const { code, newPassword } = await req.json();

  if (!code || !newPassword) {
    return NextResponse.json({ ok: false, error: "Code and new password required" }, { status: 400 });
  }

  if (
    newPassword.length < 8 ||
    !/[A-Z]/.test(newPassword) ||
    !/[a-z]/.test(newPassword) ||
    !/\d/.test(newPassword)
  ) {
    return NextResponse.json(
      { ok: false, error: "Password must be at least 8 characters with uppercase, lowercase, and a number" },
      { status: 400 }
    );
  }

  // Find valid code
  const { data: codes } = await supabaseAdmin
    .from("verification_codes")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "password_change")
    .eq("used", false)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (!codes || codes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No valid code found. Start over." },
      { status: 400 }
    );
  }

  const record = codes[0];

  if (record.attempts >= 5) {
    await supabaseAdmin
      .from("verification_codes")
      .update({ used: true })
      .eq("id", record.id);
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Start over." },
      { status: 429 }
    );
  }

  await supabaseAdmin
    .from("verification_codes")
    .update({ attempts: record.attempts + 1 })
    .eq("id", record.id);

  if (record.code !== code.trim()) {
    return NextResponse.json(
      { ok: false, error: `Incorrect code. ${4 - record.attempts} attempts remaining.` },
      { status: 401 }
    );
  }

  // Reusing the current password is not a password change. The client
  // blocks it too, but a client check is a convenience and this is the
  // rule. Asking Supabase to sign in with the NEW password is the only way
  // to know, since the stored hash is not readable from here: if it
  // succeeds, the "new" password is the one already on the account.
  try {
    if (!userEmail) throw new Error("no email on account");
    const { createClient } = await import("@supabase/supabase-js");
    const probe = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: sameErr } = await probe.auth.signInWithPassword({
      email: userEmail,
      password: newPassword,
    });
    if (!sameErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "Your new password must be different from your current one",
        },
        { status: 400 },
      );
    }
  } catch {
    // A probe that cannot run must not block a legitimate change. The
    // client-side check still applies and the worst case is someone
    // setting the password they already had.
  }

  // Update password
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: "Failed to update password" },
      { status: 500 }
    );
  }

  // Mark code as used
  await supabaseAdmin
    .from("verification_codes")
    .update({ used: true })
    .eq("id", record.id);

  return NextResponse.json({ ok: true });
}