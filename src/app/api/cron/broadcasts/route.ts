import { NextRequest, NextResponse } from "next/server";
import { dispatchDueBroadcasts } from "../../_broadcast";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Sends scheduled broadcasts whose time has come.
 *
 * Separate from the milestone cron because the two need different
 * cadences. Milestones are calendar dates, so once a day is right.
 * A scheduled broadcast is set to a time of day, so this wants to run
 * every fifteen minutes or so. Combining them would mean either waking
 * the calendar up needlessly or making scheduling accurate to a day.
 *
 * Nothing here is time-sensitive to the second: a message scheduled for
 * 18:00 goes out at the first run after 18:00. The admin screen says so
 * rather than implying a precision this does not have.
 *
 * Safe to run as often as you like, and safe to run twice at once. Each
 * row is claimed with a conditional update before delivery, so overlapping
 * runs cannot double-send.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sent, failed } = await dispatchDueBroadcasts();

  // Deliberately small: cron-job.org aborts a response over its size limit
  // and records the run as failed, so this reports counts and ids rather
  // than echoing the messages themselves.
  return NextResponse.json({
    ok: true,
    sent: sent.length,
    failed: failed.length,
    ids: sent.map((s) => s.id),
  });
}
