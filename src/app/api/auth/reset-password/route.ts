// src/app/api/auth/reset-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();

  const { email, code, newPassword } = await req.json();

  if (!email || !code || !newPassword) {
    return NextResponse.json({ ok: false, error: "All fields required" }, { status: 400 });
  }

  const cleanEmail = email.trim().toLowerCase();

  if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return NextResponse.json(
      { ok: false, error: "Password must be at least 8 characters with uppercase, lowercase, and a number" },
      { status: 400 }
    );
  }

  // Find valid code
  const { data: codes } = await supabaseAdmin
    .from("verification_codes")
    .select("*")
    .eq("email", cleanEmail)
    .eq("type", "password_reset")
    .eq("used", false)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (!codes || codes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No valid code found. Request a new one." },
      { status: 400 }
    );
  }

  const record = codes[0];

  // Max 5 attempts per code
  if (record.attempts >= 5) {
    await supabaseAdmin
      .from("verification_codes")
      .update({ used: true })
      .eq("id", record.id);
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Request a new code." },
      { status: 429 }
    );
  }

  // Increment attempts
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

  // Code correct — update password
  if (!record.user_id) {
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    record.user_id,
    { password: newPassword }
  );

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: "Failed to update password. Try again." },
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