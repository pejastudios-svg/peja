// src/app/api/auth/reset-password/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * RETIRED alongside /api/auth/forgot-password.
 *
 * This consumed the `password_reset` codes that endpoint issued. With no
 * route minting them any more, accepting them would only leave a way to
 * burn codes that are already sitting unused in `verification_codes` from
 * before the change. Refusing here invalidates that backlog outright.
 *
 * Replacements: /api/recovery/redeem (a saved code) and
 * /api/recovery/status (finishing a contact-approved recovery). Both set
 * the password only after proving identity through something that is not
 * the phone in the requester's hand. See the sibling route for why that
 * distinction matters.
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
