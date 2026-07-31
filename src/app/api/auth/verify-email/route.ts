import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";

// Check the signup code and mark the address confirmed. Mirrors the
// password-reset checks: newest unused code only, 15 minute expiry, and
// a hard attempt cap so a 6-digit code cannot be guessed.

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const email = (user.email || "").trim().toLowerCase();
    const { code } = await req.json();
    const clean = String(code ?? "").trim();

    if (!clean) {
      return NextResponse.json({ error: "Enter the code" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: codes } = await supabaseAdmin
      .from("verification_codes")
      .select("*")
      .eq("email", email)
      .eq("type", "email_verification")
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    const record = codes?.[0];
    if (!record) {
      return NextResponse.json(
        { error: "That code has expired. Send a new one." },
        { status: 400 },
      );
    }

    // Cap guesses: 6 digits is only strong if you get few tries.
    if ((record.attempts ?? 0) >= 5) {
      await supabaseAdmin
        .from("verification_codes")
        .update({ used: true })
        .eq("id", record.id);
      return NextResponse.json(
        { error: "Too many attempts. Send a new code." },
        { status: 429 },
      );
    }

    if (record.code !== clean) {
      await supabaseAdmin
        .from("verification_codes")
        .update({ attempts: (record.attempts ?? 0) + 1 })
        .eq("id", record.id);
      return NextResponse.json({ error: "That code is not right" }, { status: 400 });
    }

    await supabaseAdmin
      .from("verification_codes")
      .update({ used: true })
      .eq("id", record.id);

    await supabaseAdmin
      .from("users")
      .update({ email_verified: true })
      .eq("id", user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not verify the code" }, { status: 500 })
    );
  }
}
