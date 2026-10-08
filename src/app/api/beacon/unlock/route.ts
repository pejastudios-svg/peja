import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";
import { verifyPin } from "@/lib/adminSession";

export const runtime = "nodejs";

/**
 * Unlock the Beacon section for this account.
 *
 * Checked here and not in the browser, deliberately. The code is six
 * digits, so the whole keyspace is a million guesses. Shipping it, or a
 * hash of it, to the client would mean shipping the answer: a laptop
 * exhausts that in well under a second. Server side, with a rate limit,
 * the same guessing takes years.
 *
 * verifyPin is the same scrypt comparison the admin PIN uses, including
 * the constant-time compare, so a timing side channel cannot leak digits.
 *
 * The result is written to the user row rather than returned as a token,
 * because the unlock has to survive reinstalls and new devices, and
 * because anything the client stores is something the client can forge.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);

    // Tight. A real person types this once, correctly, having been told
    // it. Ten tries an hour makes a million-guess sweep take centuries
    // while never getting in the way of someone who simply mistyped.
    if (await isRateLimitedDurable(`beacon-unlock:${user.id}`, 10, 3600)) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Try again later." },
        { status: 429 },
      );
    }

    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ ok: false, error: "Enter the code" }, { status: 400 });
    }

    const storedHash = process.env.BEACON_UNLOCK_HASH;
    if (!storedHash) {
      console.error("[beacon/unlock] BEACON_UNLOCK_HASH is not set");
      return NextResponse.json({ ok: false, error: "Server mis-configured" }, { status: 500 });
    }

    if (!verifyPin(code.trim(), storedHash)) {
      // Deliberately vague. Saying how it was wrong is free information.
      return NextResponse.json({ ok: false, error: "That code is not correct" }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("users")
      .update({ beacon_unlocked_at: new Date().toISOString() })
      .eq("id", user.id);

    if (error) {
      console.error("[beacon/unlock] could not persist unlock:", error.message);
      return NextResponse.json({ ok: false, error: "Could not save. Try again." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ ok: false, error: "Failed" }, { status: 500 })
    );
  }
}
