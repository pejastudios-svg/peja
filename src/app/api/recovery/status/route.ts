import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";
import { sendPushToUser } from "../../_firebaseAdmin";

export const runtime = "nodejs";

/**
 * Poll a recovery request, and once the delay has run out, set a new
 * password with it.
 *
 * The countdown is deliberately visible to whoever started this. If it is
 * the real owner, they watch a clock. If it is not, the real owner has
 * been holding a cancel button on every device since the moment it began.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  const supabaseAdmin = getSupabaseAdmin();

  const { data: r } = await supabaseAdmin
    .from("recovery_requests")
    .select("id, status, unlock_at, approvals_required, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!r) return NextResponse.json({ ok: false }, { status: 404 });

  const { count: approvals } = await supabaseAdmin
    .from("recovery_approvers")
    .select("*", { count: "exact", head: true })
    .eq("request_id", r.id)
    .eq("approved", true);

  const ready = r.status === "approved" && !!r.unlock_at && r.unlock_at <= new Date().toISOString();
  return NextResponse.json({
    ok: true,
    status: r.status,
    approvals: approvals || 0,
    required: r.approvals_required,
    unlockAt: r.unlock_at,
    // Never a password-setting token, only a flag. The POST below checks
    // the clock again server-side.
    ready,
  });
}

export async function POST(req: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  const { requestId, newPassword } = await req.json();
  if (!requestId || !newPassword) {
    return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
  }
  if (
    newPassword.length < 8 ||
    !/[A-Z]/.test(newPassword) ||
    !/[a-z]/.test(newPassword) ||
    !/\d/.test(newPassword)
  ) {
    return NextResponse.json(
      { ok: false, error: "Password must be at least 8 characters with uppercase, lowercase, and a number" },
      { status: 400 },
    );
  }
  if (await isRateLimitedDurable(`recovery-finish:${requestId}`, 5, 3600)) {
    return NextResponse.json({ ok: false, error: "Too many attempts" }, { status: 429 });
  }

  const { data: r } = await supabaseAdmin
    .from("recovery_requests")
    .select("id, user_id, status, unlock_at")
    .eq("id", String(requestId))
    .maybeSingle();
  if (!r) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  // Re-check everything here. The GET above is a convenience for the UI,
  // never the authority.
  if (r.status !== "approved" || !r.unlock_at) {
    return NextResponse.json({ ok: false, error: "Not approved yet" }, { status: 409 });
  }
  if (r.unlock_at > new Date().toISOString()) {
    return NextResponse.json({ ok: false, error: "Still in the waiting period" }, { status: 409 });
  }

  // Claim it before changing anything, so a replayed request cannot reset
  // the password twice.
  const { data: claimed } = await supabaseAdmin
    .from("recovery_requests")
    .update({ status: "unlocked" })
    .eq("id", r.id)
    .eq("status", "approved")
    .select("id");
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ ok: false, error: "Already used" }, { status: 409 });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(r.user_id, {
    password: newPassword,
  });
  if (error) {
    console.error("[recovery/status] password update failed:", error.message);
    return NextResponse.json({ ok: false, error: "Could not update the password" }, { status: 500 });
  }

  sendPushToUser({
    userId: r.user_id,
    title: "Your password was changed",
    body: "Account recovery completed and your password was reset. If this was not you, secure your account immediately.",
    data: { type: "recovery_completed" },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
