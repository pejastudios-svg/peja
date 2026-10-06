import { NextRequest, NextResponse } from "next/server";
import { sendBroadcast } from "../../_broadcast";
import { lagosToday, milestonesFor } from "@/lib/milestones";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One job, once a day: is today on the calendar, and if so, send it.
 *
 * Deliberately not one cron entry per holiday. Twenty-two schedules to
 * maintain by hand is twenty-two chances for one to be wrong, and adding a
 * day would mean touching cron-job.org instead of the code.
 *
 * Idempotent by construction. Every send carries a milestone_key of
 * "<key>-<year>", and a unique index on that column means a retry, a double
 * trigger, or a manual re-run cannot send Christmas twice. A 409 back from
 * sendBroadcast is the guard working, so it is reported as skipped rather
 * than as an error.
 *
 * Dates are resolved in Africa/Lagos. On a UTC host, midnight-hour runs
 * would otherwise land on the wrong side of the date.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { year, month, day } = lagosToday();
  const due = milestonesFor(year, month, day);

  if (due.length === 0) {
    return NextResponse.json({ ok: true, date: `${year}-${month}-${day}`, sent: [], skipped: [] });
  }

  const sent: string[] = [];
  const skipped: { key: string; reason: string }[] = [];

  for (const m of due) {
    // A heavy message with nothing attached is an interruption, not help.
    // Rather than guess a helpline, the calendar carries a blank and this
    // skips the day until a real one is filled in. See lib/milestones.ts.
    if (m.requiresResource && !m.resourceText?.trim()) {
      skipped.push({ key: m.key, reason: "no resource configured" });
      continue;
    }

    const result = await sendBroadcast({
      title: m.title,
      body: m.body,
      resourceText: m.resourceText?.trim() || null,
      audience: m.audience ?? { kind: "all" },
      delivery: m.delivery,
      milestoneKey: `${m.key}-${year}`,
    });

    if (result.ok) sent.push(m.key);
    else if (result.status === 409) skipped.push({ key: m.key, reason: "already sent" });
    else skipped.push({ key: m.key, reason: result.error });
  }

  return NextResponse.json({ ok: true, date: `${year}-${month}-${day}`, sent, skipped });
}
