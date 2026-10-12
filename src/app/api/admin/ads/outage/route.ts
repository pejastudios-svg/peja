import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, authErrorResponse } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { sendPushToUser } from "../../../_firebaseAdmin";

export const runtime = "nodejs";
// Notifying every affected advertiser can be tens of thousands of rows.
export const maxDuration = 300;

const CHUNK = 500;
function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Recent outages, newest first. */
export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { data } = await supabaseAdmin
      .from("ad_outages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    return NextResponse.json({ ok: true, outages: data || [] });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/**
 * Declare an outage and credit everyone it touched.
 *
 * The crediting itself is one SQL function, set-based, inside a single
 * transaction: fifty thousand placements is one statement, not fifty
 * thousand round trips, and it either all lands or none of it does.
 *
 * Telling people happens here afterwards, chunked, because that part can
 * partially fail without any harm. A missed push is an inconvenience; a
 * half-applied credit would be a mess.
 */
export async function POST(req: NextRequest) {
  try {
    const { user: admin } = await requireAdminSession(req);
    const b = await req.json();

    const startedAt = new Date(b?.startedAt);
    const endedAt = new Date(b?.endedAt);
    const reason = String(b?.reason ?? "").trim().slice(0, 300);
    const scope = String(b?.scope ?? "all");

    if (isNaN(startedAt.getTime()) || isNaN(endedAt.getTime()) || endedAt <= startedAt) {
      return NextResponse.json({ error: "Check the start and end times" }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "Say what happened" }, { status: 400 });
    }
    if (!["all", "state", "lga", "tier"].includes(scope)) {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: outage, error: insErr } = await supabaseAdmin
      .from("ad_outages")
      .insert({
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        scope,
        scope_state: b?.scopeState || null,
        scope_lga: b?.scopeLga || null,
        scope_tier: b?.scopeTier || null,
        reason,
        created_by: admin.id,
      })
      .select("id")
      .single();

    if (insErr || !outage) {
      console.error("[ads/outage] insert failed:", insErr?.message);
      return NextResponse.json({ error: "Could not record the outage" }, { status: 500 });
    }

    const { data: result, error: rpcErr } = await supabaseAdmin.rpc("apply_ad_outage", {
      p_outage: outage.id,
      p_admin: admin.id,
    });

    if (rpcErr) {
      console.error("[ads/outage] apply failed:", rpcErr.message);
      return NextResponse.json({ error: "Could not apply the credit" }, { status: 500 });
    }

    const row = Array.isArray(result) ? result[0] : result;
    const placements = row?.placements ?? 0;
    const days = row?.days ?? 0;

    // Tell the advertisers. Non-blocking in spirit: a failure here must
    // not undo credit that is already applied, so errors are logged and
    // the call still reports success.
    try {
      const { data: credited } = await supabaseAdmin
        .from("ad_credits")
        .select("days, placement_id, ad_placements ( advertiser_id, ends_at, advertisers ( business_name, owner_user_id ) )")
        .eq("outage_id", outage.id)
        .limit(50_000);

      type Target = { userId: string; business: string; days: number; endsAt: string | null };
      const targets: Target[] = [];
      for (const c of (credited || []) as unknown as Array<{
        days: number;
        ad_placements: { ends_at: string | null; advertisers: { business_name: string; owner_user_id: string } | null } | null;
      }>) {
        const a = c.ad_placements?.advertisers;
        if (a?.owner_user_id) {
          targets.push({
            userId: a.owner_user_id,
            business: a.business_name,
            days: c.days,
            endsAt: c.ad_placements?.ends_at ?? null,
          });
        }
      }

      for (const part of chunk(targets, CHUNK)) {
        await supabaseAdmin.from("notifications").insert(
          part.map((t) => ({
            user_id: t.userId,
            type: "ad_credit",
            title: `${t.days} ${t.days === 1 ? "day" : "days"} credited to your advert`,
            body:
              `${t.business} was not showing properly, and that was on us. ` +
              `We have added ${t.days} ${t.days === 1 ? "day" : "days"} to make up for it` +
              (t.endsAt ? `. It now runs to ${new Date(t.endsAt).toLocaleDateString()}.` : "."),
            data: { type: "ad_credit", outage_id: outage.id },
            is_read: false,
          })),
        );
      }

      for (const part of chunk(targets, 50)) {
        await Promise.all(
          part.map((t) =>
            sendPushToUser({
              userId: t.userId,
              title: `${t.days} ${t.days === 1 ? "day" : "days"} credited`,
              body: `${t.business} was not showing properly. We have extended your advert.`,
              data: { type: "ad_credit", outage_id: outage.id },
              collapseKey: `ad_credit_${outage.id}`,
            }).catch(() => 0),
          ),
        );
      }
    } catch (e) {
      console.error("[ads/outage] notify failed, credit already applied:", e);
    }

    return NextResponse.json({ ok: true, outageId: outage.id, placements, days });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
