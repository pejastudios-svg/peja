import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);

    const supabaseAdmin = getSupabaseAdmin();
    const now = Date.now();
    const cutoff24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const cutoff5d = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();

    // Posts: live -> resolved after 24h
    const { error: postsErr } = await supabaseAdmin
      .from("posts")
      .update({ status: "resolved" })
      .eq("status", "live")
      .lt("created_at", cutoff24h);

    if (postsErr) throw postsErr;

    // SOS: active -> resolved after 24h
    const { error: sosErr } = await supabaseAdmin
      .from("sos_alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("status", "active")
      .lt("created_at", cutoff24h);

    if (sosErr) throw sosErr;

    // SML safety check-ins: active -> cancelled after 5 days from start.
    // A check-in that's been active for 5 days is almost certainly
    // forgotten — the user moved on but never tapped Cancel. The
    // per-interval "missed" cron handles the short-window case (user
    // doesn't confirm within their chosen interval). This is the
    // long-tail cleanup. "cancelled" matches the existing status
    // enum — no schema change needed.
    const { error: smlErr } = await supabaseAdmin
      .from("safety_checkins")
      .update({ status: "cancelled" })
      .eq("status", "active")
      .lt("created_at", cutoff5d);

    if (smlErr) throw smlErr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}