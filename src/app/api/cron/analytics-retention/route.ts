import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

// Retention sweep for the analytics firehose. app_events and user_sessions
// are append-only and were never pruned, so they grew without bound (billions
// of rows/quarter at scale) and made every analytics query slower over time.
// This runs daily from Vercel Cron (see vercel.json) and drops rows past the
// retention window.
//
// NOTE: the first run on an already-large table performs one big delete. At
// serious scale, replace the plain delete below with a batched SQL function
// (delete ... where ctid in (select ctid ... limit N)) called in a loop —
// tracked in the Supabase pass. Daily runs keep every subsequent delete
// bounded to roughly one day of rows.
const RETENTION_DAYS = 90;

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
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error: eventsErr } = await supabaseAdmin
      .from("app_events")
      .delete()
      .lt("created_at", cutoff);
    if (eventsErr) throw eventsErr;

    // Sessions are keyed on activity, not creation — prune by last_seen_at.
    const { error: sessionsErr } = await supabaseAdmin
      .from("user_sessions")
      .delete()
      .lt("last_seen_at", cutoff);
    if (sessionsErr) throw sessionsErr;

    // Prune old SOS-alert notifications (the notifications page used to DELETE
    // these on every load; now it just hides them and this sweep removes them).
    const sosCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: sosErr } = await supabaseAdmin
      .from("notifications")
      .delete()
      .eq("type", "sos_alert")
      .lt("created_at", sosCutoff);
    if (sosErr) throw sosErr;

    return NextResponse.json({ ok: true, cutoff });
  } catch (e: any) {
    console.error("[cron/analytics-retention] failed", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
