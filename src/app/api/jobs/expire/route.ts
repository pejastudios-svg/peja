import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

// Scheduled maintenance sweep. Runs from Vercel Cron (see vercel.json),
// NOT from clients: it uses the service role to mutate every user's rows,
// so it must be gated by CRON_SECRET rather than a logged-in session.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const queryToken = req.nextUrl.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  const authorized =
    (expected && authHeader === `Bearer ${expected}`) ||
    (expected && queryToken === expected);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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
    console.error("[jobs/expire] failed", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}