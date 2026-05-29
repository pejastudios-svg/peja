import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { requireUser } from "../../../_auth";

export const runtime = "nodejs";

// Revoke either a stored enrollment or a pending invitation token.
// We use one endpoint with a `kind` discriminator so the security page
// can call the same shape regardless of which list the row came from.
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { data: callerCheck } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!callerCheck?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { kind, id } = await req.json();
    if (kind !== "enrollment" && kind !== "token") {
      return NextResponse.json({ error: "kind must be enrollment|token" }, { status: 400 });
    }
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const nowIso = new Date().toISOString();

    if (kind === "enrollment") {
      const { error } = await supabaseAdmin
        .from("admin_face_enrollments")
        .update({ revoked_at: nowIso, revoked_by: user.id })
        .eq("id", id)
        .is("revoked_at", null);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabaseAdmin
        .from("admin_face_enrollment_tokens")
        .update({ revoked_at: nowIso })
        .eq("token", id)
        .is("used_at", null)
        .is("revoked_at", null);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    await supabaseAdmin.from("admin_access_log").insert({
      user_id: user.id,
      action: "face_revoked",
      ip_address:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown",
      user_agent: req.headers.get("user-agent") || "unknown",
      metadata: { kind, id },
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
