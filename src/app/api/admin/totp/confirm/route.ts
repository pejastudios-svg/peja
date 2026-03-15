import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { requireUser } from "../../../_auth";
import * as OTPAuth from "otpauth";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    // Verify caller is admin
    const { data: adminCheck } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    // Get the stored (not yet enabled) secret
    const { data: totpRecord } = await supabaseAdmin
      .from("admin_totp")
      .select("id, secret, is_enabled")
      .eq("user_id", user.id)
      .single();

    if (!totpRecord) {
      return NextResponse.json({ error: "No TOTP setup found. Start setup first." }, { status: 400 });
    }

    if (totpRecord.is_enabled) {
      return NextResponse.json({ error: "TOTP is already enabled" }, { status: 400 });
    }

    // Verify the code
    const totp = new OTPAuth.TOTP({
      issuer: "Peja Admin",
      label: "Admin",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(totpRecord.secret),
    });

    const delta = totp.validate({ token: code.trim(), window: 1 });

    if (delta === null) {
      return NextResponse.json({ error: "Invalid code. Make sure your authenticator is synced." }, { status: 400 });
    }

    // Enable TOTP
    await supabaseAdmin
      .from("admin_totp")
      .update({ is_enabled: true, updated_at: new Date().toISOString() })
      .eq("id", totpRecord.id);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || "Server error" },
      { status: 500 }
    );
  }
}