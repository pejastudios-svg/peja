import { sendEmail } from "./_email";
import { sendPushToUser } from "./_firebaseAdmin";

/**
 * Deliver a one-time auth code, push first, email as the fallback.
 *
 * Email is the expensive channel: the whole app shares one consumer Gmail
 * quota, and signup codes, password resets and ops alerts all draw on it.
 * Push costs nothing, arrives instantly, and lands on a device the person
 * is already holding rather than an inbox they have to go and open.
 *
 * It is also the safer channel. The notification reaches a device with a
 * logged-in session, and if someone else triggers a reset the real owner's
 * phone buzzes immediately instead of the attempt sitting unseen in an
 * inbox.
 *
 * Email is not removed, only demoted: a user on a laptop, or one who never
 * granted notification permission, still gets their code.
 *
 * Deliberately does NOT write a notifications row. A one-time code has no
 * business sitting in the in-app notification history after it expires.
 */
export type CodePurpose = "signup" | "reset" | "change";

const PUSH_COPY: Record<CodePurpose, (code: string) => { title: string; body: string }> = {
  signup: (code) => ({
    title: "Confirm your email",
    body: `${code} is your peja confirmation code. It expires in 15 minutes.`,
  }),
  reset: (code) => ({
    title: "Password reset requested",
    body: `${code} is your peja reset code. If this was not you, ignore this and your password stays unchanged.`,
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
