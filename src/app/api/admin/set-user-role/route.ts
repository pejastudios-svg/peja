import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { userId, role, value } = await req.json();

    if (!userId || !["admin", "guardian"].includes(role) || typeof value !== "boolean") {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const patch = role === "admin" ? { is_admin: value } : { is_guardian: value };

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("users")
      .update(patch)
      .eq("id", userId)
      .select("id,is_admin,is_guardian,email,full_name")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: `${error.code || ""} ${error.message}`.trim() },
        { status: 400 }
      );
    }

        // If guardian access was revoked, notify the user (normal notifications table)
    if (role === "guardian" && value === false) {
      await supabaseAdmin.from("notifications").insert({
        user_id: userId,
        type: "system",
        title: "Guardian access revoked",
        body: "Your Guardian access has been removed. If you believe this is a mistake, contact support.",
        data: { reason: "revoked_guardian" },
        is_read: false,
      });
    }

    return NextResponse.json({ ok: true, user: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}