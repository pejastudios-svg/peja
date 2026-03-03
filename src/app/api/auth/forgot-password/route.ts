// src/app/api/auth/forgot-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ ok: false, error: "Email required" }, { status: 400 });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Rate limit: max 3 requests per email per 15 min
  const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("verification_codes")
    .select("*", { count: "exact", head: true })
    .eq("email", cleanEmail)
    .eq("type", "password_reset")
    .gte("created_at", fifteenAgo);

  if ((count || 0) >= 3) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again in 15 minutes." },
      { status: 429 }
    );
  }

  // Check if user exists (but don't reveal this to the caller)
  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", cleanEmail)
    .limit(1);

  // Always return success (don't reveal if email exists)
  if (!users || users.length === 0) {
    return NextResponse.json({ ok: true });
  }

  // Generate 6-digit code
  const code = crypto.randomInt(100000, 999999).toString();

  // Invalidate old codes
  await supabaseAdmin
    .from("verification_codes")
    .update({ used: true })
    .eq("email", cleanEmail)
    .eq("type", "password_reset")
    .eq("used", false);

  // Store new code (expires in 10 minutes)
  await supabaseAdmin.from("verification_codes").insert({
    user_id: users[0].id,
    email: cleanEmail,
    code,
    type: "password_reset",
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  // Send email
  const webhookUrl = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
  const webhookSecret = process.env.APPS_SCRIPT_WEBHOOK_SECRET;

  if (webhookUrl) {
    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:20px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="margin:0;font-size:22px">Password Reset</h1>
    <p style="margin:4px 0 0;opacity:.9">Peja Security</p>
  </div>
  <div style="background:#1a1a2e;color:#e0e0e0;padding:24px;border:1px solid #333">
    <p>You requested a password reset. Use this code to set a new password:</p>
    <div style="text-align:center;margin:24px 0">
      <div style="display:inline-block;background:#0f0a1e;border:2px solid #7c3aed;border-radius:12px;padding:16px 32px;font-size:32px;font-family:monospace;letter-spacing:8px;color:#a855f7;font-weight:bold">
        ${code}
      </div>
    </div>
    <p style="text-align:center;color:#888;font-size:13px">This code expires in 10 minutes.</p>
    <p style="margin-top:16px;color:#888;font-size:13px">If you didn't request this, ignore this email. Your password won't change.</p>
  </div>
  <div style="background:#111;color:#555;padding:12px;border-radius:0 0 12px 12px;text-align:center;font-size:11px">
    Peja Security System
  </div>
</div>`;

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: webhookSecret,
          to: cleanEmail,
          subject: `${code} is your Peja password reset code`,
          html,
        }),
      });
    } catch {}
  }

  return NextResponse.json({ ok: true });
}