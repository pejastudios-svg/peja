import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

const KINDS = new Set(["impression", "tap", "social", "directions"]);

/**
 * Record that a placement was shown or acted on.
 *
 * Writes into a daily counter rather than an events table. At a million
 * users a row per impression would be the largest thing in the database
 * within a week, and the dashboard only ever shows totals anyway.
 *
 * Unauthenticated, and deliberately so: requiring a session would mean
 * no impressions are counted for logged-out viewers, who still saw the
 * advert. The exposure is inflated counts if somebody scripts it, which
 * costs an advertiser nothing and is caught by the taps-to-impressions
 * ratio looking absurd.
 */
export async function POST(req: NextRequest) {
  try {
    const { placementIds, kind } = await req.json();
    if (!Array.isArray(placementIds) || !KINDS.has(kind)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const ids = placementIds.filter((x) => typeof x === "string").slice(0, 20);
    if (ids.length === 0) return NextResponse.json({ ok: true });

    const supabaseAdmin = getSupabaseAdmin();
    await Promise.all(
      ids.map((id) =>
        supabaseAdmin.rpc("bump_ad_stat", { p_placement: id, p_kind: kind, p_count: 1 }),
      ),
    );
    return NextResponse.json({ ok: true });
  } catch {
    // Never surface a metrics failure to the user.
    return NextResponse.json({ ok: true });
  }
}
