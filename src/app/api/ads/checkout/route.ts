import { NextRequest, NextResponse } from "next/server";
import { adsEnabled } from "@/lib/ads";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { availability } from "../../_ads";
import type { AdTier } from "@/lib/ads";
import {
  initializeTransaction,
  makeReference,
  paystackReady,
  toKobo,
} from "@/lib/paystack";

/**
 * Start payment for a placement the advertiser has just submitted.
 *
 * The amount is read from the placement row, never from the request.
 * A client that can name its own price will eventually name one.
 */
export async function POST(req: NextRequest) {
  if (!adsEnabled()) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const { user } = await requireUser(req);

    if (!paystackReady()) {
      return NextResponse.json(
        { ok: false, error: "Payments are not available yet. Please try again shortly." },
        { status: 503 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const placementId = String(body?.placementId ?? "").trim();
    if (!placementId) {
      return NextResponse.json({ ok: false, error: "Missing placement" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: placement } = await supabaseAdmin
      .from("ad_placements")
      .select("id, status, price_naira, tier, state, lga, advertiser_id, advertisers ( id, owner_user_id, business_name, contact_email )")
      .eq("id", placementId)
      .single();

    const advertiser = (placement as unknown as {
      advertisers: { id: string; owner_user_id: string; business_name: string; contact_email: string | null } | null;
    } | null)?.advertisers;

    if (!placement || !advertiser) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (advertiser.owner_user_id !== user.id) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (placement.status !== "awaiting_payment") {
      return NextResponse.json(
        { ok: false, error: "This advert has already been paid for." },
        { status: 409 },
      );
    }

    // Paystack needs an address to attach the customer to. The business
    // contact if they gave one, otherwise the account they signed up
    // with, which is the one they can actually receive a receipt at.
    const email = advertiser.contact_email?.trim() || user.email;
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Add a contact email to your business first." },
        { status: 400 },
      );
    }

    // Asked again, here, at the last possible moment. The check at apply
    // time can be hours stale: somebody who starts a checkout, leaves,
    // and comes back must not be able to buy a slot that sold in the
    // meantime. Better to refuse the money than to take it for nothing.
    const avail = await availability(
      (placement as { state: string | null }).state ?? "",
      (placement as { lga: string | null }).lga ?? "",
      placement.tier as AdTier,
    );
    if (avail.soldOut) {
      return NextResponse.json(
        {
          ok: false,
          soldOut: true,
          error: "That area filled up while you were deciding. Nothing has been charged.",
        },
        { status: 409 },
      );
    }

    const amountKobo = toKobo(placement.price_naira);
    const reference = makeReference("init", placement.id);

    // The row goes in before the call out. If Paystack succeeds and we
    // crash before recording it, a payment exists that we have no record
    // of; this way the worst case is a pending row for a checkout that
    // was never started, which the cron sweeps.
    const { error: payErr } = await supabaseAdmin.from("ad_payments").insert({
      placement_id: placement.id,
      advertiser_id: advertiser.id,
      amount_kobo: amountKobo,
      kind: "initial",
      status: "pending",
      reference,
    });
    if (payErr) {
      console.error("[ads/checkout] payment row failed:", payErr.message);
      return NextResponse.json({ ok: false, error: "Could not start payment. Try again." }, { status: 500 });
    }

    const origin = req.nextUrl.origin;
    try {
      const res = await initializeTransaction({
        email,
        amountKobo,
        reference,
        callbackUrl: `${origin}/advertise/paid?ref=${encodeURIComponent(reference)}`,
        metadata: {
          placement_id: placement.id,
          advertiser_id: advertiser.id,
          business_name: advertiser.business_name,
          tier: placement.tier,
          kind: "initial",
        },
      });

      return NextResponse.json({
        ok: true,
        authorizationUrl: res.data.authorization_url,
        reference,
        amountNaira: placement.price_naira,
      });
    } catch (e) {
      await supabaseAdmin
        .from("ad_payments")
        .update({ status: "failed", failure_reason: (e as Error).message })
        .eq("reference", reference);
      console.error("[ads/checkout] initialize failed:", (e as Error).message);
      return NextResponse.json(
        { ok: false, error: "Could not reach the payment provider. Try again." },
        { status: 502 },
      );
    }
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
