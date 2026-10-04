import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { canUseBeacon } from "@/lib/beacon";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!canUseBeacon(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();
    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

    // Releasing a Beacon has to clear the WIRING, not just the flag.
    // Leaving family/SOS numbers behind meant a later re-pair that failed
    // to reach the `familynum` text left the hardware still dialling the
    // previous owner's contacts, with the app showing the new ones.
    // The row itself stays so the owner keeps their history.
    const { error } = await supabaseAdmin
      .from("devices")
      .update({
        status: "unpaired",
        family1_contact_id: null,
        family2_contact_id: null,
        sos_msisdn: null,
        active_sos_alert_id: null,
        sos_escalated_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", device.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Hand the device back to the vendor platform. Queued, not returned
    // as a to-do list: the previous version handed these to the client,
    // which never sent them, so the Beacon kept reporting to our gateway
    // and the next heartbeat flipped it back to connected.
    const commands = [
      { label: "Return device to factory platform", sms: "adminip123456 www.gps2828.com 7018" },
      { label: "Restart device", sms: "reset123456" },
    ];
    await supabaseAdmin.from("beacon_config_jobs").insert({
      device_id: device.id,
      created_by: user.id,
      commands,
      kind: "release",
      status: "queued",
    });

    return NextResponse.json({ ok: true, commands, queued: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
