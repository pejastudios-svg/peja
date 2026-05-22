import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

// Toggle the MVP flag on a user row. Mirrors set-vip-status — both
// flags coexist (a user can be MVP and VIP at once, though
// practically MVP supersedes VIP for visibility). Admin-gated.

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession(req);

    const { userId, value } = await req.json();
    if (!userId || typeof value !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "Missing userId or value" },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .update({ is_mvp: value })
      .eq("id", userId)
      .select("id, full_name, email, is_vip, is_mvp")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, user });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    const unauth =
      msg.toLowerCase().includes("unauthorized") ||
      msg.toLowerCase().includes("admin");
    return NextResponse.json(
      { ok: false, error: msg },
      { status: unauth ? 403 : 500 }
    );
  }
}
