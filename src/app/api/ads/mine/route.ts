import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

/** The advertiser's own businesses, placements and numbers. */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { data: advertisers } = await supabaseAdmin
      .from("advertisers")
      .select("id, business_name, category, tagline, logo_url, socials, status, rejection_reason, created_at")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: false });

    const ids = (advertisers || []).map((a) => a.id);
    if (ids.length === 0) return NextResponse.json({ ok: true, advertisers: [], placements: [] });

    const { data: placements } = await supabaseAdmin
      .from("ad_placements")
      .select("id, advertiser_id, tier, state, lga, status, rejection_reason, price_naira, auto_renew, starts_at, ends_at, next_charge_at, hidden_at, created_at")
      .in("advertiser_id", ids)
      .order("created_at", { ascending: false });

    // Last 30 days, summed per placement. The dashboard shows totals, so
    // the rollup happens here rather than shipping 30 rows per placement.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: stats } = await supabaseAdmin
      .from("ad_daily_stats")
      .select("placement_id, day, impressions, taps, social_clicks, direction_taps")
      .in("placement_id", (placements || []).map((p) => p.id))
      .gte("day", since);

    const totals: Record<string, { impressions: number; taps: number; social: number; directions: number }> = {};
    for (const s of stats || []) {
      const t = (totals[s.placement_id] ||= { impressions: 0, taps: 0, social: 0, directions: 0 });
      t.impressions += s.impressions;
      t.taps += s.taps;
      t.social += s.social_clicks;
      t.directions += s.direction_taps;
    }

    return NextResponse.json({
      ok: true,
      advertisers: advertisers || [],
      placements: (placements || []).map((p) => ({ ...p, stats: totals[p.id] || null })),
    });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
