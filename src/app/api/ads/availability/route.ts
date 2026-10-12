import { NextRequest, NextResponse } from "next/server";
import { availability } from "../../_ads";
import { catchmentFor, formatCatchment } from "@/lib/lgaCatchment";
import { AD_TIERS, type AdTier } from "@/lib/ads";

export const runtime = "nodejs";

/**
 * What an area costs, what is left in it, and how big it is.
 *
 * Drives the tier chooser. The catchment figure returned here is the
 * population of the LGA, and the field is named so that nothing
 * downstream can mistake it for a view count.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const state = sp.get("state");
  const lga = sp.get("lga");
  if (!state || !lga) {
    return NextResponse.json({ ok: false, error: "state and lga required" }, { status: 400 });
  }

  const pop = catchmentFor(state, lga);
  const tiers = await Promise.all(
    AD_TIERS.map(async (t) => ({
      tier: t.id as AdTier,
      ...(await availability(state, lga, t.id)),
    })),
  );

  return NextResponse.json({
    ok: true,
    state,
    lga,
    estimatedAreaPopulation: pop,
    estimatedAreaPopulationLabel: pop ? formatCatchment(pop) : null,
    tiers,
  });
}
