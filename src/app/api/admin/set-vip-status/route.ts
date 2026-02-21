import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user: adminUser } = await requireAdmin(req);

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
      console.error("[set-vip-status] Error:", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    console.log(
      `[set-vip-status] Admin ${adminUser.id} ${value ? "granted" : "revoked"} VIP for user ${userId}`
    );

    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    console.error("[set-vip-status] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: e?.message?.includes("Unauthorized") ? 403 : 500 }
    );
  }
}