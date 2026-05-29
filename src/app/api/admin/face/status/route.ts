import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { requireUser } from "../../../_auth";

export const runtime = "nodejs";

// Lightweight check used by AdminPinGate on mount to decide whether the
// face phase should run at all. If no faces are enrolled, the gate
// skips face verification entirely — soft-launch so a deploy doesn't
// lock anyone out before they've enrolled.
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
      return NextResponse.json({ enabled: false }, { status: 200 });
    }

    const { count } = await supabaseAdmin
      .from("admin_face_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("revoked_at", null);

    return NextResponse.json({
      ok: true,
      enabled: (count ?? 0) > 0,
      enrollmentCount: count ?? 0,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
