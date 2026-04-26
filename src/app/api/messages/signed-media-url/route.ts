import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

const BUCKET = "message-media";
const SIGN_TTL_SECONDS = 60 * 60; // 1 hour
const PATH_RE = /^messages\/([^/]+)\/[^/]+$/;

// Mints a short-lived signed URL for a private DM media file, but only if the
// caller is a participant of the conversation that owns the path.
//
// Path convention (set by messages/[id]/page.tsx upload code):
//   messages/<conversation_id>/<file>
// Anything else is rejected.
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const path = req.nextUrl.searchParams.get("path");
    if (!path) {
      return NextResponse.json({ ok: false, error: "Missing path" }, { status: 400 });
    }

    const match = path.match(PATH_RE);
    if (!match) {
      return NextResponse.json({ ok: false, error: "Invalid path" }, { status: 400 });
    }
    const conversationId = match[1];

    const admin = getSupabaseAdmin();

    const { data: membership, error: membershipErr } = await admin
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipErr || !membership) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { data: signed, error: signedErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGN_TTL_SECONDS);

    if (signedErr || !signed?.signedUrl) {
      return NextResponse.json({ ok: false, error: "Sign failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      url: signed.signedUrl,
      expiresIn: SIGN_TTL_SECONDS,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
