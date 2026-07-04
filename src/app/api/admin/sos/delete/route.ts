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
    const { sosId } = await req.json();
    if (!sosId) return NextResponse.json({ ok: false, error: "Missing sosId" }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin.from("sos_alerts").delete().eq("id", sosId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[admin/sos/delete] failed", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}