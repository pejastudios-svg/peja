import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, authErrorResponse } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { toNaira } from "@/lib/paystack";
import type { AdTier } from "@/lib/ads";

export const runtime = "nodejs";

/**
 * The advertising board: what is running, and what has been paid.
 *
 * Money is summed from ad_payments, never from the placements' list
 * price. The two disagree the moment anything is refunded or credited,
 * and the ledger is the half that is true.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();

    const [{ data: placements }, { data: payments }] = await Promise.all([
      supabaseAdmin.from("ad_placements").select("status, tier, failed_attempts, hidden_at, ends_at"),
      supabaseAdmin.from("ad_payments").select("amount_kobo, status, kind, paid_at"),
    ]);

    const byStatus: Record<string, number> = {};
    const byTier: Record<string, number> = {};
    let overdue = 0;

    for (const p of placements || []) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      // Tiers are counted on what is actually running. Counting rejected
      // and abandoned rows here would make a quiet month look busy.
      if (p.status === "live" || p.status === "paused") {
        byTier[p.tier as AdTier] = (byTier[p.tier as AdTier] || 0) + 1;
      }
      if ((p.failed_attempts ?? 0) > 0 && p.status === "live") overdue++;
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let grossKobo = 0;
    let refundedKobo = 0;
    let thisMonthKobo = 0;
    let pendingKobo = 0;

    for (const t of payments || []) {
      if (t.status === "pending") {
        // Checkouts opened and not finished. Not revenue, but worth
        // seeing: a large number here means people are reaching the
        // payment screen and bouncing off it.
        pendingKobo += t.amount_kobo;
        continue;
      }
      if (t.kind === "refund") {
        refundedKobo += Math.abs(t.amount_kobo);
        continue;
      }
      if (t.status !== "success" && t.status !== "refunded") continue;
      grossKobo += t.amount_kobo;
      if (t.paid_at && new Date(t.paid_at) >= startOfMonth) thisMonthKobo += t.amount_kobo;
    }

    return NextResponse.json({
      ok: true,
      counts: {
        awaitingPayment: byStatus.awaiting_payment || 0,
        pending: byStatus.pending || 0,
        live: byStatus.live || 0,
        paused: byStatus.paused || 0,
        rejected: byStatus.rejected || 0,
        expired: byStatus.expired || 0,
        cancelled: byStatus.cancelled || 0,
        overdue,
        total: (placements || []).length,
      },
      byTier: {
        listed: byTier.listed || 0,
        promoted: byTier.promoted || 0,
        featured: byTier.featured || 0,
      },
      revenue: {
        grossNaira: toNaira(grossKobo),
        refundedNaira: toNaira(refundedKobo),
        netNaira: toNaira(grossKobo - refundedKobo),
        thisMonthNaira: toNaira(thisMonthKobo),
        unpaidCheckoutsNaira: toNaira(pendingKobo),
      },
    });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}
