import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";
import {
  chargeAuthorization,
  makeReference,
  paystackReady,
  toKobo,
} from "@/lib/paystack";
import { formatNaira } from "@/lib/ads";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Renewals, dunning and housekeeping for adverts.
 *
 * Runs daily. Everything it does is idempotent and safe to run twice,
 * because a cron that cannot be re-run after a failure is a cron that
 * has to be fixed by hand at the worst possible moment.
 *
 * The dunning ladder is deliberately slow. A declined card is almost
 * never somebody refusing to pay, it is a daily limit or an expired
 * card, and pulling a paid advert down the same afternoon over a bank's
 * hiccup costs more in goodwill than the month is worth:
 *
 *   day 1-3  retry daily, tell them, advert keeps running
 *   day 4    advert stops showing, the slot is still theirs
 *   day 7    slot released, advert expired
 */
const HIDE_AFTER_FAILURES = 4;
const RELEASE_AFTER_FAILURES = 7;

// An unpaid checkout is somebody who closed the tab. Held long enough to
// come back and finish, not so long that it blocks a sold-out area.
const ABANDON_AFTER_HOURS = 24;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const now = new Date();
  const out = { charged: 0, failed: 0, hidden: 0, released: 0, abandoned: 0, expired: 0, warned: 0 };

  // ------------------------------------------------------------------
  // Abandoned checkouts
  // ------------------------------------------------------------------
  // Runs whether or not Paystack is configured: these rows hold slots in
  // the availability count, so leaving them would show an area as sold
  // out because of carts nobody ever completed.
  const abandonCutoff = new Date(now.getTime() - ABANDON_AFTER_HOURS * 3600_000);
  const { data: abandoned } = await supabaseAdmin
    .from("ad_placements")
    .update({ status: "cancelled" })
    .eq("status", "awaiting_payment")
    .lt("created_at", abandonCutoff.toISOString())
    .select("id");
  out.abandoned = abandoned?.length ?? 0;

  // ------------------------------------------------------------------
  // Terms that simply ran out
  // ------------------------------------------------------------------
  // auto_renew off and the end date passed: nothing to charge, it just
  // stops. Separate from the dunning path because this is not a failure
  // and should never be described to the advertiser as one.
  const { data: ended } = await supabaseAdmin
    .from("ad_placements")
    .update({ status: "expired" })
    .eq("status", "live")
    .eq("auto_renew", false)
    .lt("ends_at", now.toISOString())
    .select("id");
  out.expired = ended?.length ?? 0;

  // ------------------------------------------------------------------
  // The three day warning
  // ------------------------------------------------------------------
  // Promised in the advertiser terms, so it has to actually happen. The
  // window is [now+3d, now+4d), which shifts forward by exactly one day
  // on each daily run, so every placement falls inside it once and is
  // told once. That is why there is no "reminded_at" column: the
  // arithmetic already makes this idempotent, and a column that has to
  // be reset every cycle is one more thing to get wrong.
  const warnFrom = new Date(now.getTime() + 3 * 86_400_000).toISOString();
  const warnTo = new Date(now.getTime() + 4 * 86_400_000).toISOString();
  const { data: upcoming } = await supabaseAdmin
    .from("ad_placements")
    .select("id, price_naira, next_charge_at, advertisers ( business_name, owner_user_id )")
    .eq("status", "live")
    .eq("auto_renew", true)
    .gte("next_charge_at", warnFrom)
    .lt("next_charge_at", warnTo)
    .limit(500);

  type Upcoming = {
    id: string;
    price_naira: number;
    next_charge_at: string | null;
    advertisers: { business_name: string; owner_user_id: string } | null;
  };

  for (const p of ((upcoming as unknown as Upcoming[]) || [])) {
    if (!p.advertisers?.owner_user_id) continue;
    const on = p.next_charge_at ? new Date(p.next_charge_at).toLocaleDateString() : "in three days";
    await tell(
      p.advertisers.owner_user_id,
      "Your advert renews in 3 days",
      `${p.advertisers.business_name} renews on ${on} for ${formatNaira(p.price_naira)}. ` +
        `Cancel before then from your adverts page if you do not want it to continue.`,
      p.id,
    );
    out.warned++;
  }

  if (!paystackReady()) {
    return NextResponse.json({ ok: true, ...out, billing: "skipped, no key" });
  }

  // ------------------------------------------------------------------
  // Renewals
  // ------------------------------------------------------------------
  const { data: due } = await supabaseAdmin
    .from("ad_placements")
    .select(
      "id, tier, price_naira, failed_attempts, ends_at, next_charge_at, hidden_at, " +
        "advertisers ( id, business_name, owner_user_id, contact_email, paystack_authorization_code )",
    )
    .eq("status", "live")
    .eq("auto_renew", true)
    .lte("next_charge_at", now.toISOString())
    .limit(200);

  type Due = {
    id: string;
    tier: string;
    price_naira: number;
    failed_attempts: number;
    ends_at: string | null;
    hidden_at: string | null;
    advertisers: {
      id: string;
      business_name: string;
      owner_user_id: string;
      contact_email: string | null;
      paystack_authorization_code: string | null;
    } | null;
  };

  for (const p of ((due as unknown as Due[]) || [])) {
    const adv = p.advertisers;
    if (!adv) continue;

    // No card on file. Treated as a failed attempt rather than skipped,
    // so it still walks the dunning ladder and the advertiser is told,
    // instead of running free forever because of a missing column.
    if (!adv.paystack_authorization_code) {
      await recordFailure(p, adv, "No card on file", out);
      continue;
    }

    const email = adv.contact_email?.trim();
    if (!email) {
      await recordFailure(p, adv, "No billing email", out);
      continue;
    }

    const reference = makeReference("renew", p.id);
    const amountKobo = toKobo(p.price_naira);

    // Recorded before the charge, so a crash mid-flight leaves evidence
    // that an attempt was made rather than a silent gap.
    await supabaseAdmin.from("ad_payments").insert({
      placement_id: p.id,
      advertiser_id: adv.id,
      amount_kobo: amountKobo,
      kind: "renewal",
      status: "pending",
      reference,
    });

    try {
      const res = await chargeAuthorization({
        email,
        amountKobo,
        authorizationCode: adv.paystack_authorization_code,
        reference,
        metadata: { placement_id: p.id, advertiser_id: adv.id, kind: "renewal" },
      });

      if (res.data.status === "success") {
        // The webhook does the extending. Both paths run the same code
        // that way, so a renewal settled here and one settled by a
        // webhook cannot drift apart. If the webhook never arrives the
        // next run picks it up, because next_charge_at is still past.
        out.charged++;
      } else {
        await supabaseAdmin
          .from("ad_payments")
          .update({
            status: "failed",
            failure_reason: res.data.gateway_response || res.data.status,
          })
          .eq("reference", reference);
        await recordFailure(p, adv, res.data.gateway_response || "Card declined", out);
      }
    } catch (e) {
      await supabaseAdmin
        .from("ad_payments")
        .update({ status: "failed", failure_reason: (e as Error).message })
        .eq("reference", reference);
      await recordFailure(p, adv, (e as Error).message, out);
    }
  }

  return NextResponse.json({ ok: true, ...out });
}

/**
 * One rung down the dunning ladder.
 *
 * Pushes next_charge_at a day out so the next run retries rather than
 * hammering the same card repeatedly within one run.
 */
async function recordFailure(
  p: { id: string; failed_attempts: number; hidden_at: string | null },
  adv: { business_name: string; owner_user_id: string },
  reason: string,
  out: { failed: number; hidden: number; released: number },
) {
  const supabaseAdmin = getSupabaseAdmin();
  const attempts = (p.failed_attempts ?? 0) + 1;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  out.failed++;

  if (attempts >= RELEASE_AFTER_FAILURES) {
    await supabaseAdmin
      .from("ad_placements")
      .update({ status: "expired", failed_attempts: attempts })
      .eq("id", p.id);
    out.released++;
    await tell(
      adv.owner_user_id,
      "Your advert has ended",
      `We could not take payment for ${adv.business_name} after a week of trying, so the slot has been released. You can book again any time.`,
      p.id,
    );
    return;
  }

  const hide = attempts >= HIDE_AFTER_FAILURES;
  await supabaseAdmin
    .from("ad_placements")
    .update({
      failed_attempts: attempts,
      next_charge_at: tomorrow,
      ...(hide && !p.hidden_at ? { hidden_at: new Date().toISOString() } : {}),
    })
    .eq("id", p.id);

  if (hide && !p.hidden_at) {
    out.hidden++;
    await tell(
      adv.owner_user_id,
      "Your advert has been paused",
      `We still could not take payment for ${adv.business_name}, so it has stopped showing. Your slot is held until day 7. Update your card to bring it back.`,
      p.id,
    );
  } else if (!hide) {
    await tell(
      adv.owner_user_id,
      "We could not take your payment",
      `Payment for ${adv.business_name} did not go through (${reason}). We will try again tomorrow. Your advert is still running.`,
      p.id,
    );
  }
}

async function tell(userId: string, title: string, body: string, placementId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  try {
    await supabaseAdmin.from("notifications").insert({
      user_id: userId,
      type: "ad_billing",
      title,
      body,
      data: { type: "ad_billing", placement_id: placementId },
      is_read: false,
    });
    await sendPushToUser({
      userId,
      title,
      body,
      data: { type: "ad_billing", placement_id: placementId },
      collapseKey: `ad_billing_${placementId}`,
    }).catch(() => 0);
  } catch (e) {
    console.error("[ads-billing] notify failed:", (e as Error).message);
  }
}
