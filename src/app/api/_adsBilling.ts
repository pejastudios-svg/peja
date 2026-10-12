import { getSupabaseAdmin } from "./_supabaseAdmin";
import { paystackReady, refundTransaction } from "@/lib/paystack";

/**
 * How long after submitting an advertiser can pull out and get it all
 * back. Only applies while nobody has approved it: once it is live they
 * have had what they paid for, and `cancel` stops the renewal instead.
 */
export const SELF_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Give back everything successfully taken for one placement.
 *
 * Reads the payments rather than the placement price, because the price
 * on the row can be edited and what was actually charged cannot. Each
 * refund is recorded as its own negative row, so the ledger still adds
 * up to what the advertiser is really out of pocket.
 *
 * Never throws. Every caller is doing something more important than the
 * refund, and a failure here must not leave an advert we will not run
 * sitting in the queue. A refund that fails is a support ticket; the
 * error is logged with the reference so it can be done by hand.
 */
export async function refundForPlacement(placementId: string, reason: string): Promise<number> {
  let refunded = 0;
  try {
    if (!paystackReady()) return 0;
    const supabaseAdmin = getSupabaseAdmin();
    const { data: paid } = await supabaseAdmin
      .from("ad_payments")
      .select("id, reference, amount_kobo, advertiser_id")
      .eq("placement_id", placementId)
      .eq("status", "success")
      .gt("amount_kobo", 0);

    for (const p of paid || []) {
      try {
        await refundTransaction({ reference: p.reference, reason });
        await supabaseAdmin.from("ad_payments").insert({
          placement_id: placementId,
          advertiser_id: p.advertiser_id,
          amount_kobo: -p.amount_kobo,
          kind: "refund",
          status: "success",
          reference: `${p.reference}_refund`,
          paid_at: new Date().toISOString(),
        });
        await supabaseAdmin.from("ad_payments").update({ status: "refunded" }).eq("id", p.id);
        refunded += p.amount_kobo;
      } catch (e) {
        console.error(`[ads] refund failed for ${p.reference}:`, (e as Error).message);
      }
    }
  } catch (e) {
    console.error("[ads] refund sweep failed:", (e as Error).message);
  }
  return refunded;
}
