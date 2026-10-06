import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";

export const runtime = "nodejs";

/**
 * Replace an admin-issued temporary password with one the user chooses.
 *
 * Deliberately NOT the normal change-password flow. That one sends a
 * six-digit confirmation code, which here would be pure obstruction: the
 * person is holding a temporary password that an admin emailed them, they
 * are already locked out of their own life, and the code would arrive on a
 * device they may not have. The temporary password itself is the proof,
 * and it is single-purpose and short-lived by design.
 *
 * Still requires the temporary password rather than trusting the session
 * alone, so a borrowed or hijacked session cannot set a new password while
 * the account sits in this state.
 *
 * Refuses outright unless must_change_password is set, so this cannot
 * become a quiet side door around the normal change-password rules.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!user.email) {
      return NextResponse.json({ ok: false, error: "Account has no email" }, { status: 400 });
    }

    if (await isRateLimitedDurable(`forced-change:${user.id}`, 10, 900)) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Try again shortly." },
        { status: 429 },
      );
    }

    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ ok: false, error: "Both passwords are required" }, { status: 400 });
    }
    if (
      newPassword.length < 8 ||
      !/[A-Z]/.test(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/\d/.test(newPassword)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Password must be at least 8 characters with uppercase, lowercase, and a number",
        },
        { status: 400 },
      );
    }
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { ok: false, error: "Choose a password different from the temporary one" },
        { status: 400 },
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: row } = await supabaseAdmin
      .from("users")
      .select("must_change_password")
      .eq("id", user.id)
      .maybeSingle();
    if (!row?.must_change_password) {
      return NextResponse.json(
        { ok: false, error: "No password change is pending on this account" },
        { status: 409 },
      );
    }

    // Re-authenticate against Supabase rather than trusting the session.
    const check = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: pwErr } = await check.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (pwErr) {
      return NextResponse.json(
        { ok: false, error: "That temporary password is not correct" },
        { status: 401 },
      );
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (updateError) {
      console.error("[complete-forced-change] update failed:", updateError.message);
      return NextResponse.json({ ok: false, error: "Could not set the password" }, { status: 500 });
    }

    // Clear the flag only once the password is actually changed, so a
    // failure here leaves the gate up rather than letting someone through
    // still holding the temporary password.
    await supabaseAdmin
      .from("users")
      .update({ must_change_password: false })
      .eq("id", user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ ok: false, error: "Failed" }, { status: 500 })
    );
  }
}
