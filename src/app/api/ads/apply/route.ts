import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";
import { availability } from "../../_ads";
import { AD_TIERS, queueDeposit, tierSpec, type AdTier, adsEnabled } from "@/lib/ads";

export const runtime = "nodejs";

/**
 * Apply to advertise.
 *
 * Creates the business and the placement in one go, both as 'pending'.
 * NOTHING here goes live: everything waits for a person to review it.
 * On a safety map that is not a nicety, it is the only thing standing
 * between the product and whatever a stranger decides to upload.
 *
 * If the area is sold out at the chosen tier, this returns a queue offer
 * with the deposit instead of creating a placement. The caller then
 * confirms separately, so nobody is charged by accident on a form submit.
 *
 * Prices are read from the server's own tier table, never from the
 * request. A client that posts its own price is ignored.
 */
export async function POST(req: NextRequest) {
  if (!adsEnabled()) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const { user } = await requireUser(req);

    if (await isRateLimitedDurable(`ads-apply:${user.id}`, 5, 3600)) {
      return NextResponse.json(
        { ok: false, error: "Too many applications. Try again later." },
        { status: 429 },
      );
    }

    const b = await req.json();
    const tier = String(b?.tier ?? "") as AdTier;
    if (!AD_TIERS.some((t) => t.id === tier)) {
      return NextResponse.json({ ok: false, error: "Pick a plan" }, { status: 400 });
    }

    const businessName = String(b?.businessName ?? "").trim().slice(0, 120);
    const category = String(b?.category ?? "").trim().slice(0, 60);
    const tagline = String(b?.tagline ?? "").trim().slice(0, 140) || null;
    if (!businessName || !category) {
      return NextResponse.json(
        { ok: false, error: "Business name and category are required" },
        { status: 400 },
      );
    }

    const isOnlineOnly = Boolean(b?.isOnlineOnly);
    const lat = Number(b?.lat);
    const lng = Number(b?.lng);
    const state = String(b?.state ?? "").trim() || null;
    const lga = String(b?.lga ?? "").trim() || null;

    if (!state || !lga) {
      return NextResponse.json({ ok: false, error: "Pick your area" }, { status: 400 });
    }
    if (!isOnlineOnly && !(Number.isFinite(lat) && Number.isFinite(lng))) {
      return NextResponse.json({ ok: false, error: "Pick your location on the map" }, { status: 400 });
    }

    const spec = tierSpec(tier);
    if (spec.needsBanner && !String(b?.bannerText ?? "").trim()) {
      return NextResponse.json({ ok: false, error: "Add a line for your banner" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const avail = await availability(state, lga, tier);

    // Sold out: offer a place in the queue rather than taking the money.
    if (avail.soldOut) {
      return NextResponse.json({
        ok: true,
        soldOut: true,
        queue: {
          state,
          lga,
          tier,
          position: avail.queued + 1,
          depositNaira: queueDeposit(tier),
          priceNaira: spec.priceNaira,
        },
      });
    }

    const { data: advertiser, error: advErr } = await supabaseAdmin
      .from("advertisers")
      .insert({
        owner_user_id: user.id,
        business_name: businessName,
        category,
        tagline,
        logo_url: String(b?.logoUrl ?? "").trim() || null,
        socials: b?.socials && typeof b.socials === "object" ? b.socials : {},
        contact_email: String(b?.contactEmail ?? "").trim() || null,
        contact_phone: String(b?.contactPhone ?? "").trim() || null,
        is_online_only: isOnlineOnly,
        status: "pending",
      })
      .select("id")
      .single();

    if (advErr || !advertiser) {
      console.error("[ads/apply] advertiser insert failed:", advErr?.message);
      return NextResponse.json({ ok: false, error: "Could not save. Try again." }, { status: 500 });
    }

    const { data: placement, error: plErr } = await supabaseAdmin
      .from("ad_placements")
      .insert({
        advertiser_id: advertiser.id,
        tier,
        lat: isOnlineOnly ? null : lat,
        lng: isOnlineOnly ? null : lng,
        state,
        lga,
        building_type: String(b?.buildingType ?? "").trim() || null,
        banner_text: String(b?.bannerText ?? "").trim() || null,
        banner_gradient: String(b?.bannerGradient ?? "").trim() || null,
        // Server-side price. Never trust the client on what something costs.
        price_naira: spec.priceNaira,
        // Not "pending". Pending means waiting for review, and nothing
        // reaches review before it is paid for: reviewing is the
        // expensive part of this and it should not be spent on an
        // abandoned checkout.
        status: "awaiting_payment",
      })
      .select("id")
      .single();

    if (plErr || !placement) {
      console.error("[ads/apply] placement insert failed:", plErr?.message);
      return NextResponse.json({ ok: false, error: "Could not save. Try again." }, { status: 500 });
    }

    // The admin is told once payment clears, from the webhook, not here.

    return NextResponse.json({
      ok: true,
      placementId: placement.id,
      status: "awaiting_payment",
      priceNaira: spec.priceNaira,
    });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
