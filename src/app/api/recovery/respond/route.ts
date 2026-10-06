import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";

export const runtime = "nodejs";

const UNLOCK_DELAY_MIN = 10;

/**
 * A nominated contact answers a recovery request, or the account owner
 * cancels one.
 *
 * GET  -> requests waiting on me, plus any live request on my own account
 * POST -> { requestId, approve } from a contact, or { requestId, cancel }
 *         from the owner
 *
 * Reaching the approval threshold does NOT open the account. It sets a
 * clock. The owner has been pushed since the moment this started and can
 * kill it for the whole delay, which costs an impatient person ten minutes
 * and costs an imposter everything.
 */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const nowIso = new Date().toISOString();

    const { data: mine } = await supabaseAdmin
      .from("recovery_approvers")
      .select("request_id, responded_at, recovery_requests!inner(id, user_id, status, expires_at)")
      .eq("contact_user_id", user.id)
      .is("responded_at", null);

    const pending: { requestId: string; name: string }[] = [];
    for (const row of (mine || []) as any[]) {
      const r = row.recovery_requests;
      if (!r || r.status !== "pending" || r.expires_at < nowIso) continue;
      const { data: owner } = await supabaseAdmin
        .from("users").select("full_name").eq("id", r.user_id).single();
      pending.push({
        requestId: r.id,
        name: (owner?.full_name || "Someone").split(/\s+/)[0],
      });
    }

    // A live request against my own account, so the owner can cancel it.
    const { data: own } = await supabaseAdmin
      .from("recovery_requests")
      .select("id, status, unlock_at, approvals_required")
      .eq("user_id", user.id)
      .in("status", ["pending", "approved"])
      .gte("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({ ok: true, pending, ownRequest: own ?? null });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { requestId, approve, cancel } = await req.json();
    if (!requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });

    const { data: request } = await supabaseAdmin
      .from("recovery_requests")
      .select("id, user_id, status, approvals_required, expires_at")
      .eq("id", String(requestId))
      .maybeSingle();
    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // ── the owner killing it ──
    if (cancel) {
      if (request.user_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await supabaseAdmin
        .from("recovery_requests")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: user.id })
        .eq("id", request.id);
      return NextResponse.json({ ok: true, cancelled: true });
    }

    // ── a nominated contact answering ──
    if (request.status !== "pending" || request.expires_at < new Date().toISOString()) {
      return NextResponse.json({ error: "This request is no longer open" }, { status: 409 });
    }
    const { data: row } = await supabaseAdmin
      .from("recovery_approvers")
      .select("id, responded_at")
      .eq("request_id", request.id)
      .eq("contact_user_id", user.id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "You were not asked" }, { status: 403 });
    if (row.responded_at) return NextResponse.json({ error: "Already answered" }, { status: 409 });

    await supabaseAdmin
      .from("recovery_approvers")
      .update({ responded_at: new Date().toISOString(), approved: !!approve })
      .eq("id", row.id);

    // A single "no" ends it. If one person who knows them says this was
    // not them, that is the most valuable signal in the whole system.
    if (!approve) {
      await supabaseAdmin
        .from("recovery_requests")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: user.id })
        .eq("id", request.id);
      sendPushToUser({
        userId: request.user_id,
        title: "Recovery attempt declined",
        body: "One of your contacts said the request was not from you, so it has been stopped.",
        data: { type: "recovery_declined" },
      }).catch(() => {});
      return NextResponse.json({ ok: true, declined: true });
    }

    const { count: approvals } = await supabaseAdmin
      .from("recovery_approvers")
      .select("*", { count: "exact", head: true })
      .eq("request_id", request.id)
      .eq("approved", true);

    if ((approvals || 0) >= request.approvals_required) {
      const unlockAt = new Date(Date.now() + UNLOCK_DELAY_MIN * 60 * 1000).toISOString();
      await supabaseAdmin
        .from("recovery_requests")
        .update({ status: "approved", unlock_at: unlockAt })
        .eq("id", request.id);
      sendPushToUser({
        userId: request.user_id,
        title: "Account recovery approved",
        body: `Your contacts approved a recovery request. Access opens in ${UNLOCK_DELAY_MIN} minutes. If this was not you, open Peja and cancel it now.`,
        data: { type: "recovery_approved" },
      }).catch(() => {});
      return NextResponse.json({ ok: true, approved: true, unlockAt });
    }

    return NextResponse.json({
      ok: true,
      approved: true,
      remaining: request.approvals_required - (approvals || 0),
    });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
