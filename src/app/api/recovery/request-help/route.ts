import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";
import { sendPushToUser } from "../../_firebaseAdmin";
import { RECOVERY_CATEGORIES, findRecoveryCategory } from "@/lib/recoveryCategories";

export const runtime = "nodejs";

const MESSAGE_MAX = 2000;

/**
 * A locked-out user asks a human for help.
 *
 * Anonymous by necessity: the whole point is that they cannot sign in. That
 * makes it an open endpoint, and open endpoints are abusable, so two things
 * carry the weight:
 *
 * 1. Filing a ticket grants nothing. It puts a row in the support queue for
 *    a person to read. The temporary password that eventually comes out of
 *    it is handed to the ADMIN, who sends it to the address already on the
 *    account. So a stranger filing "I am locked out of someone@example.com"
 *    only causes that account's real owner to be emailed and pushed a
 *    warning. The attacker learns nothing and gains nothing.
 *
 * 2. The response never says whether the account exists. Same shape, same
 *    status, every time, or this becomes a way to test addresses.
 *
 * Rides on support_tickets so the existing admin triage screen handles it:
 * statuses, notes, archive, search. `category` is what lets that screen
 * show the right handling steps beside the ticket.
 */
function makeTicketNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PEJA-${stamp}-${rand}`;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  // Identical for every caller, so nothing here distinguishes a real
  // account from one that does not exist.
  const opaque = () => NextResponse.json({ ok: true, received: true });

  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const categoryId = String(body?.category ?? "").trim();
  const message = String(body?.message ?? "").trim();
  // Untrusted, like everything else on this form. Stored so the admin can
  // compare it against the phone already on the account: a match is real
  // signal, a mismatch is a reason to slow down.
  const phone = String(body?.phone ?? "").trim().slice(0, 40);
  const fullName = String(body?.fullName ?? "").trim().slice(0, 120);

  if (!email || !message) {
    return NextResponse.json(
      { ok: false, error: "Tell us your email and what happened" },
      { status: 400 },
    );
  }
  if (!fullName) {
    return NextResponse.json(
      { ok: false, error: "Enter your full name as it appears on the account" },
      { status: 400 },
    );
  }
  if (message.length > MESSAGE_MAX) {
    return NextResponse.json(
      { ok: false, error: `Message too long (max ${MESSAGE_MAX})` },
      { status: 400 },
    );
  }
  const category = findRecoveryCategory(categoryId) ?? RECOVERY_CATEGORIES[RECOVERY_CATEGORIES.length - 1];

  // Per IP, because there is no account to limit against. Generous enough
  // for a confused person retrying, tight enough to stop someone filing
  // hundreds of tickets to bury the real ones.
  if (ip !== "unknown" && (await isRateLimitedDurable(`recovery-help:${ip}`, 5, 3600))) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again later." },
      { status: 429 },
    );
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, full_name")
    .eq("email", email)
    .limit(1);

  // No account: stop here, say the same thing. Whoever filed this gets the
  // identical screen either way.
  if (!users || users.length === 0) return opaque();
  const owner = users[0];

  const { data: ticket } = await supabaseAdmin
    .from("support_tickets")
    .insert({
      ticket_number: makeTicketNumber(),
      user_id: owner.id,
      title: `Account recovery: ${category.label}`,
      message,
      category: category.id,
      // Nobody signed in to file this, so nobody has proved they hold the
      // account. The admin queue shows this as a banner rather than
      // letting the ticket read like the owner wrote it.
      unverified_requester: true,
      requester_name: fullName,
      requester_phone: phone || null,
      requester_ip: ip === "unknown" ? null : ip,
      status: "open",
    })
    .select("id, ticket_number")
    .single();

  if (!ticket) return opaque();

  // Tell the admin. Peja is the sole admin account, but this reads the flag
  // rather than hardcoding an id so it keeps working if that ever changes.
  const { data: admins } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("is_admin", true);

  const name = (owner.full_name || "Someone").split(/\s+/)[0];
  await Promise.all(
    (admins || []).map((a) =>
      sendPushToUser({
        userId: a.id,
        title: "Account recovery request",
        body: `Someone says they cannot get into ${name}'s account: ${category.label.toLowerCase()}. Unverified. Open Support to review.`,
        data: { type: "recovery_help_request", ticket_id: ticket.id },
      }).catch(() => 0),
    ),
  );

  return opaque();
}
