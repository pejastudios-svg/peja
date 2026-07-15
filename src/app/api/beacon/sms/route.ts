import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";
import { canUseBeacon } from "@/lib/beacon";
import { notifyAdminIfBalanceLow, sendTermiiSms, termiiConfigured } from "../../_termii";
import { isRateLimitedDurable } from "../../_rateLimit";

// Send ONE provisioning command to a Beacon's SIM via Termii. The client
// loops the sequence with ~8s gaps so the device applies them in order
// and the user sees real per-command progress.
//
// The SIM number never leaves the server: the client sends the device
// row id, we look the SIM up ourselves.

// Only the tracker's own command grammar may pass through this route, so
// a leaked session can't turn our Termii wallet into a spam cannon.
const COMMAND_SHAPE = /^(adminip|md|falldown|familynum|admin|vol|interon|reset|check)123456( [\w+. ]{1,80})?$/;

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!canUseBeacon(user.email)) {
      return NextResponse.json({ error: "Beacon is in a closed pilot" }, { status: 403 });
    }
    // A full pairing is 7 commands; 15 per 10 min leaves retry room while
    // stopping anything that would drain the SMS wallet.
    if (await isRateLimitedDurable(`beacon-sms:${user.id}`, 15, 600)) {
      return NextResponse.json(
        { error: "Too many Beacon messages right now. Wait a few minutes and try again." },
        { status: 429 },
      );
    }
    if (!termiiConfigured()) {
      // Config detail stays in the server logs; the user just needs to
      // know to fall back to manual texting.
      console.error("[beacon/sms] TERMII_API_KEY is not set");
      return NextResponse.json(
        { error: "Automatic sending is not available right now. Send the command manually." },
        { status: 503 },
      );
    }

    const body = await req.json();
    const deviceRowId = String(body.deviceId ?? "");
    const sms = String(body.sms ?? "").trim();
    if (!deviceRowId || !sms) {
      return NextResponse.json({ error: "deviceId and sms required" }, { status: 400 });
    }
    if (!COMMAND_SHAPE.test(sms)) {
      return NextResponse.json({ error: "Not a recognized Beacon command" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id, sim_msisdn, status, user_id")
      .eq("id", deviceRowId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }
    if (!device.sim_msisdn) {
      return NextResponse.json({ error: "Device has no SIM number on file" }, { status: 400 });
    }

    const result = await sendTermiiSms(device.sim_msisdn, sms);
    if (!result.ok) {
      console.error("[beacon/sms] Termii send failed:", result.error);
      return NextResponse.json(
        { error: "Couldn't reach the Beacon's SIM. Try again, or send it manually." },
        { status: 502 },
      );
    }

    // First pairing command -> the device is now being configured.
    if (sms.startsWith("adminip") && device.status === "pairing") {
      await supabaseAdmin.from("devices").update({ status: "configuring" }).eq("id", device.id);
    }

    // Low wallet -> admin alert (shared helper; never surfaces to users).
    notifyAdminIfBalanceLow(result.balance).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    const authRes = authErrorResponse(error);
    if (authRes) return authRes;
    // Internals go to the logs, not the client.
    console.error("[beacon/sms] unexpected error:", error);
    return NextResponse.json(
      { error: "Something went wrong sending to the Beacon. Try again." },
      { status: 500 },
    );
  }
}
