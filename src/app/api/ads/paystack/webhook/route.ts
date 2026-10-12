import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { sendPushToUser } from "../../../_firebaseAdmin";
import { verifyTransaction, verifyWebhookSignature, paystackReady } from "@/lib/paystack";
import { tierSpec, type AdTier } from "@/lib/ads";

/**
 * Paystack webhook.
 *
 * Three rules, and every one of them exists because the alternative
 * charges somebody twice or gives away an advert for free:
 *
 *   SIGNED. The body is HMAC'd with our secret key before anything is
 *   read out of it. This endpoint is public and unauthenticated, so
 *   without that check anyone who knows the URL can mark any advert paid.
 *
 *   VERIFIED. Even a correctly signed webhook is only a notification. We
 *   ask Paystack directly what the transaction's status and amount
 *   really are, and act on that answer rather than on the payload.
 *
 *   IDEMPOTENT. Paystack retries until it gets a 200, so the same event
 *   arrives repeatedly. Every handler checks whether it has already run
 *   for that reference and does nothing the second time.
 *
 * It returns 200 for anything it cannot act on, including events for
 * other products and references it does not recognise. A non-200 puts
 * Paystack into a retry loop that will never succeed.
 */
export async function POST(req: NextRequest) {
  // Raw, not parsed. Re-serialising the JSON changes the bytes and the
  // signature will never match.
  const raw = await req.text();

  if (!paystackReady()) return NextResponse.json({ ok: true, ignored: "not configured" });

  const valid = await verifyWebhookSignature(raw, req.headers.get("x-paystack-signature"));
  if (!valid) {
    console.warn("[paystack/webhook] bad signature");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const reference = event?.data?.reference;
  if (!reference || !reference.startsWith("peja_")) {
    return NextResponse.json({ ok: true, ignored: "not ours" });
  }

  try {
    if (event.event === "charge.success") await onChargeSuccess(reference);
    else if (event.event === "refund.processed") await onRefundProcessed(reference);
  } catch (e) {
    // Log and still return 200 only for errors we know a retry cannot
    // fix. Anything else gets a 500 so Paystack tries again.
    console.error("[paystack/webhook] handler failed:", (e as Error).message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function onChargeSuccess(reference: string) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: payment } = await supabaseAdmin
    .from("ad_payments")
    .select("id, status, placement_id, advertiser_id, amount_kobo, kind")
    .eq("reference", reference)
    .single();

  if (!payment) return; // Not a reference we issued.
  if (payment.status === "success") return; // Already handled.

  // The only answer we trust about whether money moved.
  const verified = await verifyTransaction(reference);
  const tx = verified.data;
  if (tx.status !== "success") return;

  // Guard against being told a smaller amount was paid than was owed.
  if (tx.amount < payment.amount_kobo) {
    await supabaseAdmin
      .from("ad_payments")
      .update({
        status: "failed",
        failure_reason: `Underpaid: ${tx.amount} of ${payment.amount_kobo} kobo`,
        raw: tx as unknown as Record<string, unknown>,
      })
      .eq("id", payment.id);
    console.error(`[paystack/webhook] underpayment on ${reference}`);
    return;
  }

  const auth = tx.authorization;

  await supabaseAdmin
    .from("ad_payments")
    .update({
      status: "success",
      paystack_id: tx.id,
      authorization_code: auth?.authorization_code ?? null,
      paid_at: tx.paid_at || new Date().toISOString(),
      raw: tx as unknown as Record<string, unknown>,
    })
    .eq("id", payment.id);

  // Keep the card for the renewal. Only if Paystack says it can be
  // reused: a one-time authorization stored here would fail silently
  // every month and look like the advertiser's card being declined.
  if (auth?.reusable && auth.authorization_code) {
    await supabaseAdmin
      .from("advertisers")
      .update({
        paystack_customer_code: tx.customer?.customer_code ?? null,
        paystack_authorization_code: auth.authorization_code,
        card_last4: auth.last4,
        card_brand: auth.brand,
        card_exp: `${auth.exp_month}/${auth.exp_year}`,
      })
      .eq("id", payment.advertiser_id);
  }

  if (!payment.placement_id) return;

  const { data: placement } = await supabaseAdmin
    .from("ad_placements")
    .select("id, status, tier, lga, state, ends_at, advertisers ( business_name, owner_user_id )")
    .eq("id", payment.placement_id)
    .single();
  if (!placement) return;

  const advertiser = (placement as unknown as {
    advertisers: { business_name: string; owner_user_id: string } | null;
  }).advertisers;

  if (payment.kind === "initial" && placement.status === "awaiting_payment") {
    // Paid. Now it enters the review queue, and only now.
    await supabaseAdmin
      .from("ad_placements")
      .update({ status: "pending", last_paid_at: new Date().toISOString() })
      .eq("id", placement.id);

    const { data: admins } = await supabaseAdmin.from("users").select("id").eq("is_admin", true);
    const spec = tierSpec(placement.tier as AdTier);
    await Promise.all(
      (admins || []).map((a) =>
        sendPushToUser({
          userId: a.id,
          title: "New advertiser to review",
          body: `${advertiser?.business_name ?? "A business"} paid for ${spec.name} in ${placement.lga}.`,
          data: { type: "ad_review", placement_id: placement.id },
        }).catch(() => 0),
      ),
    );
    return;
  }

  if (payment.kind === "renewal") {
    // Renewed. Extend from the existing end date rather than from today,
    // so a charge that lands a day late does not quietly cost the
    // advertiser a day of their month.
    const base = placement.ends_at && new Date(placement.ends_at) > new Date()
      ? new Date(placement.ends_at)
      : new Date();
    const ends = new Date(base);
    ends.setMonth(ends.getMonth() + 1);

    await supabaseAdmin
      .from("ad_placements")
      .update({
        status: "live",
        ends_at: ends.toISOString(),
        next_charge_at: ends.toISOString(),
        last_paid_at: new Date().toISOString(),
        failed_attempts: 0,
        hidden_at: null,
      })
      .eq("id", placement.id);

    if (advertiser?.owner_user_id) {
      await supabaseAdmin.from("notifications").insert({
        user_id: advertiser.owner_user_id,
        type: "ad_renewed",
        title: "Your advert renewed",
        body: `${advertiser.business_name} is paid up and running until ${ends.toLocaleDateString()}.`,
        data: { type: "ad_renewed", placement_id: placement.id },
        is_read: false,
      });
    }
  }
}

async function onRefundProcessed(reference: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: payment } = await supabaseAdmin
    .from("ad_payments")
    .select("id, status")
    .eq("reference", reference)
    .single();
  if (!payment || payment.status === "refunded") return;

  await supabaseAdmin
    .from("ad_payments")
    .update({ status: "refunded" })
    .eq("id", payment.id);
}
