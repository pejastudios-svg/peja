import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { refundForPlacement, SELF_CANCEL_WINDOW_MS } from "../../_adsBilling";

export const runtime = "nodejs";

/**
 * What an advertiser can do to one of their own placements.
 *
 * Deliberately per placement. Somebody running four adverts who wants
 * to stop one of them must not be offered a single button that stops
 * all four, and there is no account-wide cancel anywhere in this API.
 *
 * Three distinct things, because they are three distinct intentions and
 * collapsing them would mean somebody pausing for a week loses the
 * month they paid for:
 *
 *   pause   Hide it and stop the next renewal. The period already paid
 *           for keeps running, because days were bought, not views.
 *           Resumable until that period ends.
 *   cancel  Leave it running to the end of the paid period, then stop.
 *           No further charges. This is the kind one.
 *   delete  Take it off the map now and stop renewing. Ends the paid
 *           period early, by their choice, so nothing is refunded.
 */
type Action = "pause" | "resume" | "cancel" | "delete";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { placementId, action } = (await req.json()) as {
      placementId?: string;
      action?: Action;
    };

    if (!placementId || !action || !["pause", "resume", "cancel", "delete"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Ownership through the advertiser, not the placement. Trusting a
    // placement id from the client would let anybody pause anybody's
    // advert by guessing a uuid.
    const { data: row } = await supabaseAdmin
      .from("ad_placements")
      .select("id, status, ends_at, created_at, advertisers!inner ( owner_user_id )")
      .eq("id", placementId)
      .maybeSingle();

    const owner = (
      Array.isArray(row?.advertisers) ? row?.advertisers[0] : row?.advertisers
    ) as { owner_user_id: string } | undefined;

    if (!row || owner?.owner_user_id !== user.id) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    let patch: Record<string, unknown>;

    switch (action) {
      case "pause":
        patch = { status: "paused", hidden_at: now, auto_renew: false };
        break;
      case "resume":
        // Only back to live if there is time left on it. Resuming an
        // expired placement would otherwise put it on the map for free.
        if (row.ends_at && new Date(row.ends_at) <= new Date()) {
          return NextResponse.json(
            { ok: false, error: "This has already finished. Start a new one." },
            { status: 409 },
          );
        }
        patch = { status: "live", hidden_at: null };
        break;
      case "cancel":
        patch = { auto_renew: false };
        break;
      case "delete":
        patch = { status: "cancelled", hidden_at: now, auto_renew: false, ends_at: now };
        break;
    }

    const { error } = await supabaseAdmin
      .from("ad_placements")
      .update({ ...patch, updated_at: now })
      .eq("id", placementId);

    if (error) {
      console.error("[ads/manage] update failed:", error.message);
      return NextResponse.json({ ok: false, error: "Could not save" }, { status: 500 });
    }

    // Withdrawing something nobody has approved yet, inside the window,
    // gets the money back in full. After approval it has been reviewed
    // and run, so `cancel` stops the next charge instead and the current
    // month plays out. Attempted after the status is already saved: the
    // advert must come down whether or not Paystack cooperates.
    let refundedNaira = 0;
    if (action === "delete") {
      const neverRan = ["awaiting_payment", "pending"].includes(row.status);
      const created = row.created_at ? new Date(row.created_at).getTime() : 0;
      const inWindow = created > 0 && Date.now() - created < SELF_CANCEL_WINDOW_MS;
      if (neverRan && inWindow) {
        refundedNaira = Math.round((await refundForPlacement(placementId, "Withdrawn by advertiser")) / 100);
      }
    }

    return NextResponse.json({ ok: true, refundedNaira });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ ok: false, error: "Failed" }, { status: 500 })
    );
  }
}
