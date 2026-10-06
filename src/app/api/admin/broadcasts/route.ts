import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendBroadcast } from "../../_broadcast";
import type { BroadcastAudience, BroadcastDelivery } from "@/lib/broadcastAudience";

export const runtime = "nodejs";
// Fan-out over a large audience is slow. Push is per-token and the
// notification insert is chunked, so give it room rather than having a
// half-delivered broadcast time out.
export const maxDuration = 300;

/**
 * Create and send a broadcast.
 *
 * Audience resolution lives in SQL (broadcast_recipients), so a filter is
 * evaluated once in the database rather than by pulling every user into
 * this process and filtering in JavaScript.
 *
 * Delivery decides how far the words travel:
 *
 *   push    - lock screen plus a notification row
 *   in_app  - notification row only, nothing on the lock screen
 *   popup   - nothing is sent now; the card is shown on next app open to
 *             whoever still matches the filter at that moment
 *
 * The push/in_app split is a safety decision, not a preference. A push
 * body is readable by anyone standing near the phone, which for messages
 * about violence or self-harm can expose the very person the message is
 * meant to help.
 */

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { data } = await supabaseAdmin
      .from("broadcasts")
      .select("id, title, body, audience, delivery, status, sent_at, sent_count, milestone_key, starts_at, ends_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    return NextResponse.json({ ok: true, broadcasts: data || [] });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAdminSession(req);
    const body = await req.json();

    const title = String(body?.title ?? "").trim();
    const message = String(body?.body ?? "").trim();
    const delivery = String(body?.delivery ?? "") as BroadcastDelivery;
    const audience = body?.audience as BroadcastAudience;

    if (!title || !message) {
      return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
    }
    if (!["push", "in_app", "popup"].includes(delivery)) {
      return NextResponse.json({ error: "Pick how to deliver it" }, { status: 400 });
    }
    if (!audience?.kind) {
      return NextResponse.json({ error: "Pick who it goes to" }, { status: 400 });
    }
    if (audience.kind === "states" && (!audience.states || audience.states.length === 0)) {
      return NextResponse.json({ error: "Pick at least one state" }, { status: 400 });
    }

    const result = await sendBroadcast({
      title,
      body: message,
      audience,
      delivery,
      resourceText: body?.resourceText ? String(body.resourceText).trim() : null,
      actionUrl: body?.actionUrl ? String(body.actionUrl).trim() : null,
      endsAt: body?.endsAt || null,
      createdBy: user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, id: result.id, sentCount: result.sentCount });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}
