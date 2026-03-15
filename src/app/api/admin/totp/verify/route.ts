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

    const { code, isBackupCode } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    // Get TOTP record
    const { data: totpRecord } = await supabaseAdmin
      .from("admin_totp")
      .select("id, secret, backup_codes, is_enabled")
      .eq("user_id", user.id)
      .single();

    if (!totpRecord || !totpRecord.is_enabled) {
      return NextResponse.json({ error: "TOTP not enabled" }, { status: 400 });
    }

    // Check backup code
    if (isBackupCode) {
      const backupCodes = typeof totpRecord.backup_codes === "string"
        ? JSON.parse(totpRecord.backup_codes)
        : totpRecord.backup_codes;

      const cleanCode = code.trim().toUpperCase();
      const matchIndex = backupCodes.findIndex(
        (bc: { code: string; used: boolean }) => bc.code === cleanCode && !bc.used
      );

      if (matchIndex === -1) {
        return NextResponse.json({ error: "Invalid or already used backup code" }, { status: 400 });
      }

      // Mark backup code as used
      backupCodes[matchIndex].used = true;
      await supabaseAdmin
        .from("admin_totp")
        .update({
          backup_codes: JSON.stringify(backupCodes),
          updated_at: new Date().toISOString(),
        })
        .eq("id", totpRecord.id);

      const remaining = backupCodes.filter((bc: { used: boolean }) => !bc.used).length;

      return NextResponse.json({
        ok: true,
        backupCodesRemaining: remaining,
        warning: remaining <= 2 ? "You are running low on backup codes. Consider regenerating them." : undefined,
      });
    }

    // Verify TOTP code
    const totp = new OTPAuth.TOTP({
      issuer: "Peja Admin",
      label: "Admin",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(totpRecord.secret),
    });

    // Window of 1 means we accept the previous, current, and next code
    const delta = totp.validate({ token: code.trim(), window: 1 });

    if (delta === null) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || "Server error" },
      { status: 500 }
    );
  }
}