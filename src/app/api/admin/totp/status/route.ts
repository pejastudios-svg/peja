import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { requireUser } from "../../../_auth";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { data: adminCheck } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: totpRecord } = await supabaseAdmin
      .from("admin_totp")
      .select("is_enabled, backup_codes")
      .eq("user_id", user.id)
      .single();

    if (!totpRecord) {
      return NextResponse.json({ enabled: false, backupCodesRemaining: 0 });
    }

    const backupCodes = typeof totpRecord.backup_codes === "string"
      ? JSON.parse(totpRecord.backup_codes)
      : totpRecord.backup_codes || [];

    const remaining = backupCodes.filter((bc: { used: boolean }) => !bc.used).length;

    return NextResponse.json({
      enabled: totpRecord.is_enabled,
      backupCodesRemaining: remaining,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Server error" },
      { status: 500 }
    );
  }
}