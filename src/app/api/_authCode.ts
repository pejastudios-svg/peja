import { sendEmail } from "./_email";
import { sendPushToUser } from "./_firebaseAdmin";

/**
 * Deliver a one-time auth code, push first, email as the fallback.
 *
 * Email is the expensive channel: the whole app shares one consumer Gmail
 * quota, and signup codes and ops alerts all draw on it. Push costs
 * nothing and arrives instantly on a device the person already holds.
 *
 * WHERE PUSH IS ALLOWED, AND WHY THE LINE IS WHERE IT IS
 *
 * A code delivered to the account's own device proves possession of that
 * device and nothing else. That is fine when the code is a CONFIRMATION
 * of something the caller has already authenticated, and unacceptable
 * when the code IS the authentication.
 *
 *   signup  - ok. There is no account to steal yet; the code only ties a
 *             fresh account to a reachable address.
 *   change  - ok. The caller already proved the current password before
 *             this is ever reached, so the push is a second signal and a
 *             warning shot, not the proof.
 *   reset   - REMOVED, deliberately. "Forgot password" is exactly the
 *             case where identity is the open question, so the code was
 *             the only proof in play. Pushing it put that proof on the
 *             lock screen of the phone an attacker would be holding:
 *             pick up the phone, tap forgot password, read the
 *             notification, take the account. Do not add it back. Reset
 *             now runs through /api/recovery/redeem (a code the user
 *             saved somewhere else) or /api/recovery/start (trusted
 *             contacts vouching), both of which prove something the
 *             thief does not have.
 *
 * Deliberately does NOT write a notifications row. A one-time code has no
 * business sitting in the in-app notification history after it expires.
 */
export type CodePurpose = "signup" | "change";

const PUSH_COPY: Record<CodePurpose, (code: string) => { title: string; body: string }> = {
  signup: (code) => ({
    title: "Confirm your email",
    body: `${code} is your peja confirmation code. It expires in 15 minutes.`,
  }),
  change: (code) => ({
    title: "Confirm your password change",
    body: `${code} is your peja confirmation code. It expires in 5 minutes.`,
  }),
};

export async function deliverAuthCode(params: {
  userId: string | null;
  email: string;
  code: string;
  purpose: CodePurpose;
  subject: string;
  html: string;
}): Promise<{ delivered: boolean; channel: "push" | "email" | "none" }> {
  if (params.userId) {
    try {
      const copy = PUSH_COPY[params.purpose](params.code);
      const sent = await sendPushToUser({
        userId: params.userId,
        title: copy.title,
        body: copy.body,
        data: { type: `auth_code_${params.purpose}` },
        // A code outlives its usefulness fast. Do not let a queued push
        // surface an hour later pointing at an expired code.
        ttlMs: 5 * 60 * 1000,
        // Repeated requests replace each other rather than stacking a
        // pile of codes on the lock screen, only the newest of which works.
        collapseKey: `auth_code_${params.purpose}`,
      });
      if (sent > 0) return { delivered: true, channel: "push" };
    } catch (e) {
      console.error("[authCode] push failed, falling back to email:", e);
    }
  }

  const ok = await sendEmail({ to: params.email, subject: params.subject, html: params.html });
  return { delivered: ok, channel: ok ? "email" : "none" };
}
