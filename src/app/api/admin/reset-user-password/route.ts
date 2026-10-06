import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdminSession, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";
import { sendPushToUser } from "../../_firebaseAdmin";
import { verifyPin } from "@/lib/adminSession";

export const runtime = "nodejs";

/**
 * Issue a temporary password for a locked-out user.
 *
 * This is the last door in the building. Password reset no longer delivers
 * a code to the account's own device, so someone with no saved recovery
 * codes and fewer than two accepted contacts has no automated way back in.
 * A human opens this one.
 *
 * Two rules make it safe to have at all:
 *
 * 1. The temporary password is returned to the ADMIN, never to whoever
 *    asked. The admin sends it to the address already on the account. So a
 *    stranger filing "I am locked out of someone@example.com" achieves
 *    nothing: the password lands in the real owner's inbox and the real
 *    owner is pushed a warning. The request form is safe to leave open
 *    precisely because this endpoint does not trust it.
 *
 * 2. It is temporary. must_change_password blocks the app until it is
 *    replaced, so a password sitting in plaintext in an inbox cannot
 *    quietly become the account's permanent one.
 *
 * Re-authenticates with the PIN even though the session is already an
 * admin one, matching the SIM reveal. A hijacked admin tab should not be
 * able to take over accounts.
 */

// No 0/O/1/l/I. These get read aloud over the phone and typed by someone
// already having a bad day.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function tempPassword(): string {
  // Three groups of four, hyphenated: long enough to be unguessable, short
  // enough to dictate. Seeded so it always satisfies the app's own rule of
  // upper + lower + digit, whatever the random draw happens to be.
  const pick = (set: string) => set[crypto.randomInt(0, set.length)];
  const chars = [
    pick("ABCDEFGHJKMNPQRSTUVWXYZ"),
    pick("abcdefghijkmnpqrstuvwxyz"),
    pick("23456789"),
  ];
  while (chars.length < 12) chars.push(pick(ALPHABET));
  // Shuffle so the seeded characters are not always in the same positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const s = chars.join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function emailBody(name: string, password: string): string {
  const first = (name || "").trim().split(/\s+/)[0] || "there";
  return `Hi ${first},

We have reset the password on your peja account so you can get back in.

Your temporary password is:

${password}

Open peja, sign in with your email and this password, and you will be asked to choose a new one straight away. The temporary password stops working at that point.

While you are in, please set up your recovery codes under Settings, Security. They are twenty one-time codes you keep somewhere safe, and they are how you get yourself back in next time without waiting for us.

If you did not ask for this, tell us immediately and do not use the password above.

Peja Support`;
}

export async function POST(req: NextRequest) {
  try {
    const { user: adminUser } = await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { userId, pin } = await req.json();

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    // Never fatal. The success log runs AFTER the password has already
    // changed, so letting a logging failure bubble would report a failure
    // for an action that actually happened, and the admin would try again
    // and issue a second password over the first.
    const log = (action: string, metadata: Record<string, unknown>) =>
      supabaseAdmin
        .from("admin_access_log")
        .insert({
          user_id: adminUser.id,
          action,
          ip_address: ip,
          user_agent: ua,
          metadata,
        })
        .then(
          ({ error }) => {
            if (error) console.error("[admin/reset-user-password] audit log failed:", error.message);
          },
          (e) => console.error("[admin/reset-user-password] audit log threw:", e),
        );

    if (await isRateLimitedDurable(`admin-pw-reset:${adminUser.id}`, 10, 900)) {
      return NextResponse.json(
        { error: "Too many attempts. Wait a few minutes." },
        { status: 429 },
      );
    }

    const storedHash = process.env.ADMIN_PIN_HASH;
    if (!storedHash) {
      return NextResponse.json({ error: "Server mis-configured" }, { status: 500 });
    }
    if (!pin || typeof pin !== "string" || !verifyPin(pin, storedHash)) {
      await log("password_reset_failed", { target_user_id: userId, reason: "bad_pin" });
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    const { data: target } = await supabaseAdmin
      .from("users")
      .select("id, email, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!target.email) {
      return NextResponse.json(
        { error: "This account has no email address to send the password to." },
        { status: 400 },
      );
    }

    const password = tempPassword();

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(target.id, {
      password,
    });
    if (updateError) {
      console.error("[admin/reset-user-password] update failed:", updateError.message);
      await log("password_reset_failed", { target_user_id: userId, reason: "update_failed" });
      return NextResponse.json({ error: "Could not reset the password" }, { status: 500 });
    }

    // Flag AFTER the password actually changed. Flagging first would strand
    // the user behind a forced change for a password that never moved.
    const { error: flagError } = await supabaseAdmin
      .from("users")
      .update({
        must_change_password: true,
        password_reset_by_admin_at: new Date().toISOString(),
      })
      .eq("id", target.id);
    if (flagError) {
      // The password IS changed at this point, so this is not a failure to
      // report as one. Worst case the user keeps the temporary password
      // until they change it themselves, which the email already tells
      // them to do.
      console.error("[admin/reset-user-password] flag failed:", flagError.message);
    }

    // The real owner hears about it wherever they still have a session. If
    // this reset was obtained by someone else talking their way through
    // support, this notification is how the owner finds out.
    sendPushToUser({
      userId: target.id,
      title: "Your password was reset by support",
      body: "Check the email on your account for a temporary password. If you did not ask for this, contact us now.",
      data: { type: "admin_password_reset" },
    }).catch(() => {});

    await log("password_reset", { target_user_id: userId, target_email: target.email });

    // The password is returned to the ADMIN, who sends it to the address on
    // the account. It is never handed to whoever filed the request.
    return NextResponse.json({
      ok: true,
      tempPassword: password,
      email: target.email,
      emailText: emailBody(target.full_name || "", password),
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Failed to reset password" }, { status: 500 })
    );
  }
}
