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

  // Insert notification (shows as toast + in notifications page)
  await supabaseAdmin.from("notifications").insert({
    user_id: userId,
    type: "system",
    title: "Password Change Verification",
    body: `Your verification code: ${code}`,
    data: { code, type: "password_change" },
    is_read: false,
  });

  return NextResponse.json({ ok: true, code });
}