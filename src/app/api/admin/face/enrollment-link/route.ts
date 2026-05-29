import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { requireUser } from "../../../_auth";
import crypto from "crypto";

export const runtime = "nodejs";

// Issue an enrollment invitation. The caller must be admin; the link
// always enrolls a face under the caller's admin account (peja is the
// only admin, so every enrollment is for the shared peja account). The
// label_hint distinguishes who/which device the face belongs to —
// e.g. "Sarah's iPhone". Link is valid for 24 hours and single-use.
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

    const { labelHint } = await req.json().catch(() => ({}));

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await supabaseAdmin
      .from("admin_face_enrollment_tokens")
      .insert({
        token,
        user_id: user.id,
        created_by: user.id,
        label_hint: labelHint?.toString().slice(0, 60) || null,
        expires_at: expiresAt,
      });

    if (insertError) {
      return NextResponse.json(
        { error: `Failed to create token: ${insertError.message}` },
        { status: 500 }
      );
    }

    // Always build an absolute link. NEXT_PUBLIC_SITE_URL is set in dev
    // (.env.local -> localhost) but unset in prod, where the old empty-string
    // fallback produced a relative "/enroll-face/<token>" that's useless when
    // shared. Fall back to the canonical domain (matches the hard-coded
    // https://peja.life share links used elsewhere in the app).
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://peja.life").replace(/\/$/, "");
    const url = `${siteUrl}/enroll-face/${token}`;

    await supabaseAdmin.from("admin_access_log").insert({
      user_id: user.id,
      action: "face_enrollment_link_created",
      ip_address:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown",
      user_agent: req.headers.get("user-agent") || "unknown",
      metadata: { label_hint: labelHint?.toString().slice(0, 60) || null },
    });

    return NextResponse.json({ ok: true, url, token, expiresAt });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
