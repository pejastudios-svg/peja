import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { verifyTransaction, paystackReady } from "@/lib/paystack";

/**
 * What the advertiser's browser asks on the way back from Paystack.
 *
 * Read-only as far as the advert is concerned. The webhook is what
 * actually moves a placement into review, because the browser may never
 * come back at all: people close the tab, lose signal on the redirect,
 * or pay and walk away. This exists so the one who does come back is
 * told the truth immediately rather than watching a pending screen
 * until a webhook lands.
 */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const reference = req.nextUrl.searchParams.get("ref") || "";
    if (!reference) return NextResponse.json({ ok: false, error: "Missing reference" }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();
    const { data: payment } = await supabaseAdmin
      .from("ad_payments")
      .select("id, status, amount_kobo, placement_id, advertisers!inner ( owner_user_id, business_name )")
      .eq("reference", reference)
      .single();

    const owner = (payment as unknown as {
      advertisers: { owner_user_id: string; business_name: string } | null;
    } | null)?.advertisers;

    if (!payment || owner?.owner_user_id !== user.id) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    // Already settled by the webhook, which usually beats the redirect.
    if (payment.status === "success") {
      return NextResponse.json({ ok: true, state: "paid", businessName: owner.business_name });
    }

    if (!paystackReady()) {
      return NextResponse.json({ ok: true, state: "pending" });
    }

    try {
      const { data: tx } = await verifyTransaction(reference);
      if (tx.status === "success") {
        // Deliberately not written here. Letting two code paths settle a
        // payment is how one of them ends up extending a term twice.
        // The webhook owns that, and it is retried until it lands.
        return NextResponse.json({ ok: true, state: "paid", businessName: owner.business_name });
      }
      if (tx.status === "abandoned") return NextResponse.json({ ok: true, state: "abandoned" });
      return NextResponse.json({ ok: true, state: "failed", reason: tx.gateway_response || null });
    } catch {
      return NextResponse.json({ ok: true, state: "pending" });
    }
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
