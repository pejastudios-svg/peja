import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";
import { tierSpec, type AdTier } from "@/lib/ads";
import { refundForPlacement } from "../../_adsBilling";

export const runtime = "nodejs";

/**
 * The review desk.
 *
 * Every placement passes through here before it is visible to anybody.
 * Approving sets the advertiser and the placement live together, because
 * a live placement attached to an unapproved business would render with
 * unreviewed name, logo and links.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();
    const status = req.nextUrl.searchParams.get("status") || "pending";

    const { data } = await supabaseAdmin
      .from("ad_placements")
      .select(`
        id, tier, state, lga, building_type, banner_text, banner_gradient,
        status, rejection_reason, price_naira, lat, lng, created_at,
        advertisers ( id, business_name, category, tagline, logo_url, socials,
                      contact_email, contact_phone, is_online_only, status,
                      owner_user_id )
      `)
      .eq("status", status)
      .order("created_at", { ascending: true })
      .limit(200);

    // Counts for every tab, so the review queue shows how much is
    // waiting without having to open each one.
    const statuses = ["pending", "live", "rejected", "paused"] as const;
    const counts: Record<string, number> = {};
    await Promise.all(
      statuses.map(async (st) => {
        const { count } = await supabaseAdmin
          .from("ad_placements")
          .select("*", { count: "exact", head: true })
          .eq("status", st);
        counts[st] = count || 0;
      }),
    );

    return NextResponse.json({ ok: true, placements: data || [], counts });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user: admin } = await requireAdminSession(req);
    const { placementId, action, reason } = await req.json();

    if (!placementId || !["approve", "reject", "pause", "resume"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: row } = await supabaseAdmin
      .from("ad_placements")
      .select("id, tier, advertiser_id, advertisers ( business_name, owner_user_id )")
      .eq("id", placementId)
      .maybeSingle();

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const adv = (Array.isArray(row.advertisers) ? row.advertisers[0] : row.advertisers) as
      | { business_name: string; owner_user_id: string }
      | undefined;

    const now = new Date();

    if (action === "approve") {
      // A month from approval, not from application: nobody pays for the
      // days their submission spent sitting in this queue.
      const ends = new Date(now);
      ends.setMonth(ends.getMonth() + 1);

      await supabaseAdmin
        .from("advertisers")
        .update({
          status: "approved",
          reviewed_by: admin.id,
          reviewed_at: now.toISOString(),
          rejection_reason: null,
        })
        .eq("id", row.advertiser_id);

      await supabaseAdmin
        .from("ad_placements")
        .update({
          status: "live",
          rejection_reason: null,
          starts_at: now.toISOString(),
          ends_at: ends.toISOString(),
          next_charge_at: ends.toISOString(),
          hidden_at: null,
        })
        .eq("id", placementId);

      if (adv?.owner_user_id) {
        const title = "Your advert is live";
        const body = `${adv.business_name} is now showing on Peja as ${tierSpec(row.tier as AdTier).name}.`;
        // A row as well as a push. A push is one chance: swipe it away,
        // miss it on a locked phone, or have notifications off, and
        // there is nothing in the app to say the advert ever went live.
        await supabaseAdmin.from("notifications").insert({
          user_id: adv.owner_user_id,
          type: "ad_approved",
          title,
          body,
          data: { type: "ad_approved", placement_id: placementId },
          is_read: false,
        });
        sendPushToUser({
          userId: adv.owner_user_id,
          title,
          body,
          data: { type: "ad_approved", placement_id: placementId },
        }).catch(() => {});
      }
    }

    if (action === "reject") {
      const why = String(reason || "").trim().slice(0, 300);
      await supabaseAdmin
        .from("ad_placements")
        .update({ status: "rejected", rejection_reason: why || null })
        .eq("id", placementId);

      // They paid before review, so a rejection has to give it back in
      // full and without being asked. Attempted before the advertiser is
      // told anything, but never allowed to block the rejection itself:
      // a refund that fails is a support ticket, a rejection that fails
      // leaves an advert we will not run sitting in the queue.
      await refundForPlacement(placementId, "Advert not approved");
      await supabaseAdmin
        .from("advertisers")
        .update({
          status: "rejected",
          rejection_reason: why || null,
          reviewed_by: admin.id,
          reviewed_at: now.toISOString(),
        })
        .eq("id", row.advertiser_id);

      if (adv?.owner_user_id) {
        const title = "We could not approve your advert";
        const body = why || "Open Peja to see why and try again.";
        await supabaseAdmin.from("notifications").insert({
          user_id: adv.owner_user_id,
          type: "ad_rejected",
          title,
          body,
          data: { type: "ad_rejected", placement_id: placementId },
          is_read: false,
        });
        sendPushToUser({
          userId: adv.owner_user_id,
          title,
          body,
          data: { type: "ad_rejected", placement_id: placementId },
        }).catch(() => {});
      }
    }

    if (action === "pause") {
      await supabaseAdmin
        .from("ad_placements")
        .update({ status: "paused", hidden_at: now.toISOString() })
        .eq("id", placementId);
    }

    if (action === "resume") {
      await supabaseAdmin
        .from("ad_placements")
        .update({ status: "live", hidden_at: null })
        .eq("id", placementId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
