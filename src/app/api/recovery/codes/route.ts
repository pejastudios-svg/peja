import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";

/**
 * Recovery codes: twenty single-use six-digit codes.
 *
 * GET  -> how many remain unused (never the codes themselves)
 * POST -> generate a fresh batch, retiring any previous one
 *
 * Generation requires the current password even though the caller is
 * already signed in. Without that, anyone holding an unlocked phone could
 * mint twenty codes, screenshot them, and keep a way in that survives the
 * owner changing their password. Re-authentication is the whole defence.
 *
 * Codes are stored hashed. "We can only show these once" is then a fact
 * about the system rather than a promise: the server cannot reproduce
 * them even if asked.
 */

const CODE_COUNT = 20;

function hashCode(userId: string, code: string): string {
  // Salted per user so one leaked database cannot be rainbow-tabled
  // across accounts. Codes are short, so the salt matters more than usual.
  return crypto.createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { count: unused } = await supabaseAdmin
      .from("recovery_codes")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("used_at", null);
    const { count: total } = await supabaseAdmin
      .from("recovery_codes")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    return NextResponse.json({
      ok: true,
      hasCodes: (total || 0) > 0,
      unused: unused || 0,
      total: total || 0,
    });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!user.email) {
      return NextResponse.json({ error: "Account has no email" }, { status: 400 });
    }
    if (await isRateLimitedDurable(`recovery-codes:${user.id}`, 5, 3600)) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 },
      );
    }

    const { password } = await req.json();
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Enter your current password" }, { status: 400 });
    }

    // Re-authenticate against Supabase rather than trusting the session.
    const { createClient } = await import("@supabase/supabase-js");
    const check = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: pwErr } = await check.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (pwErr) {
      return NextResponse.json({ error: "That password is not correct" }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const batchId = crypto.randomUUID();
    const codes: string[] = [];
    const seen = new Set<string>();
    while (codes.length < CODE_COUNT) {
      const c = crypto.randomInt(100000, 1000000).toString();
      if (seen.has(c)) continue; // no duplicates inside one batch
      seen.add(c);
      codes.push(c);
    }

    // Retire the old batch only after the new one is safely written, so a
    // failure here cannot leave the account with no codes at all.
    const { error: insErr } = await supabaseAdmin.from("recovery_codes").insert(
      codes.map((c) => ({
        user_id: user.id,
        code_hash: hashCode(user.id, c),
        batch_id: batchId,
      })),
    );
    if (insErr) {
      console.error("[recovery/codes] insert failed:", insErr.message);
      return NextResponse.json({ error: "Could not create codes" }, { status: 500 });
    }
    await supabaseAdmin
      .from("recovery_codes")
      .delete()
      .eq("user_id", user.id)
      .neq("batch_id", batchId);

    // The only time these ever leave the server.
    return NextResponse.json({ ok: true, codes, count: codes.length });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
