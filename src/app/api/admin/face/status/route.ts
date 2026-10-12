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

    // Read separately and tolerate it being absent. Selecting a column
    // that does not exist fails the WHOLE query, and this endpoint
    // decides whether the gate runs its face phase at all: one
    // unapplied migration should not be able to break the security
    // page or the gate along with it.
    let paused = false;
    try {
      const { data: p } = await supabaseAdmin
        .from("users")
        .select("admin_face_paused")
        .eq("id", user.id)
        .single();
      paused = Boolean(p?.admin_face_paused);
    } catch {
      paused = false;
    }

    const { count } = await supabaseAdmin
      .from("admin_face_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("revoked_at", null);

    // Paused keeps the enrolment but skips the phase, so the gate
    // behaves exactly as it does for someone who never enrolled.
    return NextResponse.json({
      ok: true,
      enabled: (count ?? 0) > 0 && !paused,
      enrollmentCount: count ?? 0,
      paused,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
