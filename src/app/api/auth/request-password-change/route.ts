// src/app/api/auth/request-password-change/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();

  let userId: string;
  let userEmail: string;

  try {
    const { user } = await requireUser(req);
    userId = user.id;
    userEmail = user.email || "";
  } catch {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const { oldPassword } = await req.json();

  if (!oldPassword) {
    return NextResponse.json({ ok: false, error: "Current password required" }, { status: 400 });
  }

  // Rate limit: max 5 attempts per 15 min
  const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("verification_codes")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "password_change")
    .gte("created_at", fifteenAgo);

  if ((count || 0) >= 5) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 }
    );
  }

  // Verify old password by trying to sign in
  const tempClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { error: signInError } = await tempClient.auth.signInWithPassword({
    email: userEmail,
    password: oldPassword,
  });

  if (signInError) {
    return NextResponse.json(
      { ok: false, error: "Current password is incorrect" },
      { status: 401 }
    );
  }

  // Generate 6-digit code
  const code = crypto.randomInt(100000, 999999).toString();

  // Invalidate old codes
  await supabaseAdmin
    .from("verification_codes")
    .update({ used: true })
    .eq("user_id", userId)
    .eq("type", "password_change")
    .eq("used", false);

  // Store code (5 min expiry)
  await supabaseAdmin.from("verification_codes").insert({
    user_id: userId,
    email: userEmail,
    code,
    type: "password_change",
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });

  // Email the code (same channel as forgot-password). The code MUST NOT
  // appear in-app or in the API response - a code the app shows you
  // verifies nothing. Only someone with access to the account's email
  // should be able to complete a password change.
  const webhookUrl = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
  const webhookSecret = process.env.APPS_SCRIPT_WEBHOOK_SECRET;
  if (webhookUrl) {
    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:20px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="margin:0;font-size:22px">Password Change</h1>
    <p style="margin:4px 0 0;opacity:.9">Peja Security</p>
  </div>
  <div style="background:#1a1a2e;color:#e0e0e0;padding:24px;border:1px solid #333">
    <p>You requested to change your password. Use this code to confirm:</p>
    <div style="text-align:center;margin:24px 0">
      <div style="display:inline-block;background:#0f0a1e;border:2px solid #7c3aed;border-radius:12px;padding:16px 32px;font-size:32px;font-family:monospace;letter-spacing:8px;color:#a855f7;font-weight:bold">
        ${code}
      </div>
    </div>
    <p style="text-align:center;color:#888;font-size:13px">This code expires in 5 minutes.</p>
    <p style="margin-top:16px;color:#888;font-size:13px">If you didn't request this, ignore this email and consider changing your password. Your password won't change without this code.</p>
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
          to: userEmail,
          subject: `${code} is your Peja password change code`,
          html,
        }),
      });
    } catch {}
  }

  // Never returns the code. `emailed` tells the client whether the code
  // actually went out (webhook configured) so it can guide the user.
  return NextResponse.json({ ok: true, emailed: Boolean(webhookUrl) });
}