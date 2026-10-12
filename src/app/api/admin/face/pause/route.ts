import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, authErrorResponse } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../../_rateLimit";
import { verifyPin } from "@/lib/adminSession";

export const runtime = "nodejs";

/**
 * Pause or resume face verification at the admin gate.
 *
 * Asymmetric on purpose:
 *
 *   Pausing requires the PIN. It is the direction that removes a layer
 *   of protection, and an admin tab left open on a borrowed machine
 *   should not be able to switch the camera check off by itself.
 *
 *   Resuming requires nothing. Any friction on turning security back on
 *   is friction in the wrong direction, and the worst case is that
 *   protection is restored by someone who should not have been there,
 *   which is hardly a worst case.
 *
 * Neither touches the enrolment. Revoking is a separate, deliberate act.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAdminSession(req);
    const { paused, pin } = await req.json();

    if (typeof paused !== "boolean") {
      return NextResponse.json({ error: "paused must be true or false" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (paused) {
      if (await isRateLimitedDurable(`face-pause:${user.id}`, 10, 900)) {
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
        await supabaseAdmin.from("admin_access_log").insert({
          user_id: user.id,
          action: "face_pause_failed",
          ip_address:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            "unknown",
          user_agent: req.headers.get("user-agent") || "unknown",
          metadata: {},
        }).then(() => {}, () => {});
        return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
      }
    }

    const { error } = await supabaseAdmin
      .from("users")
      .update({ admin_face_paused: paused })
      .eq("id", user.id);

    if (error) {
      console.error("[face/pause] update failed:", error.message);
      return NextResponse.json({ error: "Could not save" }, { status: 500 });
    }

    supabaseAdmin.from("admin_access_log").insert({
      user_id: user.id,
      action: paused ? "face_paused" : "face_resumed",
      ip_address:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown",
      user_agent: req.headers.get("user-agent") || "unknown",
      metadata: {},
    }).then(() => {}, () => {});

    return NextResponse.json({ ok: true, paused });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
