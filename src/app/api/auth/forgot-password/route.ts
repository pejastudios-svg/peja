// src/app/api/auth/forgot-password/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * RETIRED. Password reset no longer delivers a code to the account itself.
 *
 * This endpoint used to mint a six-digit code and deliver it by push, with
 * email as the fallback. That was a mistake, and the reason is worth
 * keeping written down so nobody rebuilds it:
 *
 * A reset code's only job is to prove the requester controls something the
 * thief does not. Pushing it sent the code to the very device an attacker
 * would already be holding, where it appears on the lock screen. Anyone
 * with sixty seconds of physical access could tap "forgot password", read
 * the notification, set a new password, and lock the real owner out of a
 * personal-safety app. Delivering to the account's own device turns
 * possession of the phone into the whole of authentication.
 *
 * Recovery now goes through proofs that live somewhere else:
 *
 *   POST /api/recovery/redeem  - a code the user saved off-device
 *   POST /api/recovery/start   - trusted contacts confirm it is really them
 *
 * Both are reachable from /forgot-password, which asks which route the
 * user wants before sending anything anywhere.
 *
 * Kept as an explicit 410 rather than deleted. The route was live in
 * production, so an old cached client may still call it, and a clear
 * refusal is better than a 404 that looks like a deploy problem. It also
 * stops anyone reaching the old push-a-code behaviour directly with curl
 * while the UI no longer offers it.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Password reset has moved. Open the app and choose Forgot password to use a recovery code or ask your emergency contacts.",
      code: "endpoint_retired",
    },
    { status: 410 },
  );
}
