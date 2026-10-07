import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { APPROVALS_REQUIRED } from "../_constants";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";
import { sendPushToUser } from "../../_firebaseAdmin";

export const runtime = "nodejs";

/**
 * Trusted contact recovery.
 *
 * GET  ?email= -> the contacts this account could ask, first names only
 * POST          -> open a request naming the chosen approvers
 *
 * Peja can do this where most apps cannot: it already holds a graph of
 * MUTUALLY accepted emergency contacts. Those are not names somebody
 * typed in, both sides agreed. Asking two of them beats emailing a link,
 * because an attacker has to fool two people who know this person rather
 * than one inbox.
 *
 * Three guards make it safe to expose:
 *   - approvers are fixed when the request is created, never widened after
 *   - the owner is pushed on every device the instant it starts
 *   - approval alone does not open the account; a delay runs first
 */

/** First names only. Enough to recognise, not enough to harvest. */
function firstName(full: string | null): string {
  return (full || "Your contact").trim().split(/\s+/)[0];
}

export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
  const supabaseAdmin = getSupabaseAdmin();
  // Same shape of answer whether or not the account exists, so this
  // cannot be used to discover which addresses are registered.
  const empty = NextResponse.json({ ok: true, contacts: [], required: APPROVALS_REQUIRED });
  if (!email) return empty;

  const { data: users } = await supabaseAdmin
    .from("users").select("id").eq("email", email).limit(1);
  if (!users || users.length === 0) return empty;

  const { data: contacts } = await supabaseAdmin
    .from("emergency_contacts")
    .select("contact_user_id")
    .eq("user_id", users[0].id)
    .eq("status", "accepted")
    .not("contact_user_id", "is", null);
  const ids = (contacts || []).map((c) => c.contact_user_id as string);
  if (ids.length === 0) return empty;

  const { data: people } = await supabaseAdmin
    .from("users").select("id, full_name").in("id", ids);
  return NextResponse.json({
    ok: true,
    required: APPROVALS_REQUIRED,
    contacts: (people || []).map((p) => ({ id: p.id, name: firstName(p.full_name) })),
  });
}

export async function POST(req: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") || "unknown";

  const { email, approverIds } = await req.json();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const chosen: string[] = Array.isArray(approverIds) ? approverIds.slice(0, 5) : [];

  if (!cleanEmail || chosen.length < APPROVALS_REQUIRED) {
    return NextResponse.json(
      { ok: false, error: `Choose at least ${APPROVALS_REQUIRED} people to ask` },
      { status: 400 },
    );
  }
  // Harsh on purpose: this pings real people's phones. Nobody should be
  // able to pester someone's contacts repeatedly.
  if (
    (await isRateLimitedDurable(`recovery-start-ip:${ip}`, 5, 3600)) ||
    (await isRateLimitedDurable(`recovery-start:${cleanEmail}`, 3, 24 * 3600))
  ) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const { data: users } = await supabaseAdmin
    .from("users").select("id, full_name").eq("email", cleanEmail).limit(1);
  // Opaque success: an attacker learns nothing from this response.
  //
  // The starter DOES need the request id back, because it is what the
  // waiting screen polls and what finishes the reset. Withholding it was
  // why this route could never complete: the id was both the credential
  // and never handed to anybody.
  //
  // So every caller gets an id, real or not. A decoy is a throwaway uuid
  // that no row matches, and /api/recovery/status answers for an unknown
  // id exactly as it does for a pending one, so the response shape and
  // the subsequent polling look identical whether or not the account
  // exists. Returning the id only on success would have made this
  // endpoint an account-existence oracle.
  const decoy = () =>
    NextResponse.json({ ok: true, started: true, requestId: crypto.randomUUID() });
  if (!users || users.length === 0) return decoy();
  const owner = users[0];

  // Only genuine accepted contacts can ever be approvers, whatever the
  // client sent.
  const { data: valid } = await supabaseAdmin
    .from("emergency_contacts")
    .select("contact_user_id")
    .eq("user_id", owner.id)
    .eq("status", "accepted")
    .in("contact_user_id", chosen);
  const approvers = [...new Set((valid || []).map((v) => v.contact_user_id as string))];
  if (approvers.length < APPROVALS_REQUIRED) return decoy();

  // One live request at a time.
  await supabaseAdmin
    .from("recovery_requests")
    .update({ status: "expired" })
    .eq("user_id", owner.id)
    .eq("status", "pending");

  const { data: request } = await supabaseAdmin
    .from("recovery_requests")
    .insert({ user_id: owner.id, approvals_required: APPROVALS_REQUIRED })
    .select("id")
    .single();
  if (!request) return decoy();

  await supabaseAdmin.from("recovery_approvers").insert(
    approvers.map((id) => ({ request_id: request.id, contact_user_id: id })),
  );

  const name = (owner.full_name || "Someone").split(/\s+/)[0];
  const approverTitle = `${name} is trying to recover their account`;
  const approverBody = `Open Peja to confirm whether this was really ${name}. Only approve if you are sure.`;

  // Notification rows as well as pushes. A push is a single chance: swipe
  // it away, miss it on a locked phone, or have notifications off, and the
  // request simply vanished with no trace in the app. Someone's way back
  // into their account should not hinge on a banner being caught in time.
  await supabaseAdmin.from("notifications").insert(
    approvers.map((id) => ({
      user_id: id,
      type: "recovery_request",
      title: approverTitle,
      body: approverBody,
      data: { type: "recovery_request", request_id: request.id },
      is_read: false,
    })),
  );

  await Promise.all(
    approvers.map((id) =>
      sendPushToUser({
        userId: id,
        title: approverTitle,
        body: approverBody,
        data: { type: "recovery_request", request_id: request.id },
      }).catch(() => 0),
    ),
  );

  // The owner hears about it on every device they still hold. If this is
  // not them, this notification is the whole defence.
  // Same reasoning for the owner, and more urgently: this notification is
  // their entire defence if the request was not theirs.
  await supabaseAdmin.from("notifications").insert({
    user_id: owner.id,
    type: "recovery_started",
    title: "Someone started account recovery",
    body: "If this was not you, open Peja and cancel it now.",
    data: { type: "recovery_started", request_id: request.id },
    is_read: false,
  });

  sendPushToUser({
    userId: owner.id,
    title: "Someone started account recovery",
    body: "If this was not you, open Peja and cancel it now.",
    data: { type: "recovery_started", request_id: request.id },
  }).catch(() => {});

  return NextResponse.json({ ok: true, started: true, requestId: request.id });
}
