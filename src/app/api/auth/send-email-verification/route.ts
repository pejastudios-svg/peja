import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";
import { sendEmail } from "../../_email";
import { isRateLimitedDurable } from "../../_rateLimit";

// Send (or resend) the signup verification code to the address the user
// registered with. Proves they can actually receive mail there, which is
// what stops someone signing up as somebody else.
//
// The code NEVER appears in the response: a code the app hands you
// verifies nothing.

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const email = (user.email || "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "No email on this account" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Already done? Say so instead of sending pointless mail.
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("email_verified")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.email_verified) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    // 5 sends per 15 minutes: enough for a genuine retry, not enough to
    // use us as a mail cannon or burn the daily sending quota.
    if (await isRateLimitedDurable(`verify-email:${user.id}`, 5, 900)) {
      return NextResponse.json(
        { error: "Too many requests. Wait a few minutes and try again." },
        { status: 429 },
      );
    }

    const code = crypto.randomInt(100000, 999999).toString();

    // Retire any outstanding codes so only the newest works.
    await supabaseAdmin
      .from("verification_codes")
      .update({ used: true })
      .eq("email", email)
      .eq("type", "email_verification")
      .eq("used", false);

    await supabaseAdmin.from("verification_codes").insert({
      user_id: user.id,
      email,
      code,
      type: "email_verification",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:20px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="margin:0;font-size:22px">Confirm your email</h1>
    <p style="margin:4px 0 0;opacity:.9">peja</p>
  </div>
  <div style="background:#1a1a2e;color:#e0e0e0;padding:24px;border:1px solid #333">
    <p>Welcome to peja. Use this code to confirm your email address:</p>
    <div style="text-align:center;margin:24px 0">
      <div style="display:inline-block;background:#0f0a1e;border:2px solid #7c3aed;border-radius:12px;padding:16px 32px;font-size:32px;font-family:monospace;letter-spacing:8px;color:#a855f7;font-weight:bold">
        ${code}
      </div>
    </div>
    <p style="text-align:center;color:#888;font-size:13px">This code expires in 15 minutes.</p>
    <p style="margin-top:16px;color:#888;font-size:13px">
      If you did not create a peja account, you can ignore this email.
    </p>
  </div>
  <div style="background:#111;color:#555;padding:12px;border-radius:0 0 12px 12px;text-align:center;font-size:11px">
    PEJA STUDIOS LIMITED
  </div>
</div>`;

    const sent = await sendEmail({
      to: email,
      subject: `${code} is your peja confirmation code`,
      html,
    });

    return NextResponse.json({ ok: true, sent });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not send the code" }, { status: 500 })
    );
  }
}
