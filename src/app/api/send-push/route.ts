import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { sendPushToUser } from "../_firebaseAdmin";
import { getSupabaseAdmin } from "../_supabaseAdmin";

export const runtime = "nodejs";

// Push types this route is allowed to send. Anything else must go through a
// dedicated server route (notify-social for social, cron for safety, etc.).
// Locked down because previously any authed user could push-spam any user.
const ALLOWED_TYPES = new Set([
  "sos_alert",
  "nearby_incident",
  "system",
  "emergency_contact_invite",
  "dm_blocked",
]);

// Per-caller rate limit (defense-in-depth on top of the relationship check).
// Generous so legitimate fan-out loops (e.g. nearby_incident to ~50 users)
// don't trip it.
const callerRate = new Map<string, { count: number; resetAt: number }>();
const CALLER_LIMIT = 300; // requests per minute
const CALLER_WINDOW = 60 * 1000;

function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = callerRate.get(key);
  if (!entry || now > entry.resetAt) {
    callerRate.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { userId, title, body, data, type } = await req.json();

    if (!userId || !title) {
      return NextResponse.json({ ok: false, error: "Missing userId or title" }, { status: 400 });
    }

    const notifType = (typeof type === "string" && type) || data?.type;
    if (!notifType || !ALLOWED_TYPES.has(notifType)) {
      return NextResponse.json({ ok: false, error: "Type not permitted via this route" }, { status: 403 });
    }

    if (!rateLimit(`c:${user.id}`, CALLER_LIMIT, CALLER_WINDOW)) {
      return NextResponse.json({ ok: false, error: "Rate limit" }, { status: 429 });
    }

    // Anchor the push to a real notification row that the caller's flow just
    // wrote (subject to the notifications table's RLS). This couples FCM
    // sends to legitimate application events: an attacker can't push without
    // having also created a corresponding notification, which the table's
    // policies gate. Note row.type may be "system" with the subtype in
    // data.type — we don't try to match the subtype, just that a recent row
    // exists for this user.
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const supabaseAdmin = getSupabaseAdmin();
    const { data: anchor } = await supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .gte("created_at", since)
      .limit(1);

    if (!anchor || anchor.length === 0) {
      return NextResponse.json({ ok: false, error: "No matching notification found" }, { status: 403 });
    }

    const sentCount = await sendPushToUser({ userId, title, body: body || "", data: data || {} });

    return NextResponse.json({ ok: true, sent: sentCount });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
