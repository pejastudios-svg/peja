import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { requireUser } from "../../../_auth";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    // Verify caller is admin
    const { data: adminCheck } = await supabaseAdmin
      .from("users")
      .select("is_admin, email, full_name")
      .eq("id", user.id)
      .single();

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Generate new TOTP secret
    const secret = new OTPAuth.Secret({ size: 20 });

    const totp = new OTPAuth.TOTP({
      issuer: "Peja Admin",
      label: adminCheck.email || adminCheck.full_name || "Admin",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });

    const otpauthUrl = totp.toString();

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 256,
      margin: 2,
      color: { dark: "#ffffffFF", light: "#00000000" },
    });

    // Generate 10 backup codes
    const backupCodes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      // Format as XXXX-XXXX
      backupCodes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`);
    }

    // Store secret (not yet enabled) - upsert in case they're re-setting up
    const { error: upsertError } = await supabaseAdmin
      .from("admin_totp")
      .upsert(
        {
          user_id: user.id,
          secret: secret.base32,
          backup_codes: JSON.stringify(backupCodes.map((c) => ({ code: c, used: false }))),
          is_enabled: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to store secret: ${upsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      qrCode: qrDataUrl,
      secret: secret.base32,
      backupCodes,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || "Server error" },
      { status: 500 }
    );
  }
}