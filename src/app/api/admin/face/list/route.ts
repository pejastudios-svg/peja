import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { requireUser } from "../../../_auth";

export const runtime = "nodejs";

// Powers the /admin/security/faces page. Returns all active enrollments
// and all pending tokens (unused, unrevoked, unexpired). Descriptor
// payloads are excluded — those are large and only the verify path
// needs them.
export async function GET(req: NextRequest) {
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

    const nowIso = new Date().toISOString();

    const [enrollmentsRes, tokensRes] = await Promise.all([
      supabaseAdmin
        .from("admin_face_enrollments")
        .select("id, label, thumbnail_url, enrolled_at")
        .is("revoked_at", null)
        .order("enrolled_at", { ascending: false }),
      supabaseAdmin
        .from("admin_face_enrollment_tokens")
        .select("token, label_hint, created_at, expires_at")
        .is("used_at", null)
        .is("revoked_at", null)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false }),
    ]);

    if (enrollmentsRes.error || tokensRes.error) {
      const msg =
        enrollmentsRes.error?.message || tokensRes.error?.message || "Query failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      enrollments: enrollmentsRes.data ?? [],
      pendingTokens: tokensRes.data ?? [],
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
