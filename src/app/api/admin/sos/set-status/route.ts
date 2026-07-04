import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession(req);
  } catch {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const { sosId, status } = await req.json();
    if (!sosId || !["active", "resolved", "cancelled", "false_alarm"].includes(status)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const updates: any = { status };

    if (status !== "active") updates.resolved_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("sos_alerts")
      .update(updates)
      .eq("id", sosId)
      .select("id,status,resolved_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, sos: data });
  } catch (e: any) {
    console.error("[admin/sos/set-status] failed", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}