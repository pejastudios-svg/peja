import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Full admin gate (auth + is_admin + PIN session), matching the other
    // user-mutation routes rather than a bare is_admin read.
    await requireAdminSession(req);
  } catch {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const { userId, value } = await req.json();

    if (!userId || typeof value !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "Missing userId or value" },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Update user's VIP status
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .update({ is_vip: value })
      .eq("id", userId)
      .select("id, full_name, email, is_vip")
      .single();

    if (error) {
      console.error("[admin/set-vip-status] update failed", error);
      return NextResponse.json(
        { ok: false, error: "Update failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    console.error("[admin/set-vip-status] failed", e);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}