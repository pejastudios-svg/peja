import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { canUseBeacon, parseDeviceId, pairingCommands } from "@/lib/beacon";

/**
 * Start pairing a Beacon 1 tracker: create the devices row and return
 * the SMS provisioning sequence. During the pilot the commands are sent
 * manually from the owner's phone; the device shows up as `connected`
 * the moment it registers against the TCP gateway.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!canUseBeacon(user.email)) {
      return NextResponse.json({ error: "Beacon is not available on this account yet" }, { status: 403 });
    }

    const body = await req.json();
    const deviceId = parseDeviceId(String(body.device_id ?? ""));
    const sim = String(body.sim_msisdn ?? "").replace(/[^\d+]/g, "");
    const family1Id: string | null = body.family1_contact_id || null;
    const family2Id: string | null = body.family2_contact_id || null;

    if (!deviceId) {
      return NextResponse.json({ error: "That doesn't look like a Beacon ID" }, { status: 400 });
    }
    if (!/^(\+?234|0)\d{10}$/.test(sim)) {
      return NextResponse.json({ error: "Enter the device SIM number as 080... or +234..." }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // One Beacon belongs to exactly one account at a time. Look up ANY
    // row for this device id (not just active ones) so we can tell the
    // difference between "someone else owns it" and "it was released and
    // is free to claim".
    const { data: existing } = await supabaseAdmin
      .from("devices")
      .select("id, user_id, status")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (existing && existing.user_id !== user.id && existing.status !== "unpaired") {
      return NextResponse.json(
        { error: "This Beacon is already paired to another account. Ask the current owner to unpair it first." },
        { status: 409 },
      );
    }

    // Resolve chosen contacts to phone numbers. Contacts must be the
    // user's own ACCEPTED emergency contacts.
    async function contactPhone(contactId: string | null): Promise<string | null> {
      if (!contactId) return null;
      const { data: c } = await supabaseAdmin
        .from("emergency_contacts")
        .select("id, user_id, status, contact_user_id")
        .eq("id", contactId)
        .eq("user_id", user.id)
        .eq("status", "accepted")
        .maybeSingle();
      if (!c?.contact_user_id) return null;
      const { data: u } = await supabaseAdmin
        .from("users")
        .select("phone")
        .eq("id", c.contact_user_id)
        .single();
      return u?.phone || null;
    }

    const [family1Phone, family2Phone] = await Promise.all([
      contactPhone(family1Id),
      contactPhone(family2Id),
    ]);
    if (family1Id && !family1Phone) {
      return NextResponse.json(
        { error: "Contact 1 has no phone number on their profile" },
        { status: 400 }
      );
    }

    const row = {
      user_id: user.id,
      device_id: deviceId,
      sim_msisdn: sim,
      name: "Beacon 1",
      status: "configuring",
      family1_contact_id: family1Phone ? family1Id : null,
      family2_contact_id: family2Phone ? family2Id : null,
      sos_msisdn: family1Phone,
      volume: 1,
      updated_at: new Date().toISOString(),
    };

    // Re-pairing a row we are allowed to claim (our own, or one the
    // previous owner released) updates it. Otherwise INSERT, never a blind
    // upsert: an upsert would let two simultaneous pairings overwrite each
    // other's owner. A unique violation here means someone won the race.
    const { data: device, error } = existing
      ? await supabaseAdmin.from("devices").update(row).eq("id", existing.id).select().single()
      : await supabaseAdmin.from("devices").insert(row).select().single();
    if (error || !device) {
      if (error?.code === "23505") {
        return NextResponse.json(
          { error: "This Beacon was just paired to another account." },
          { status: 409 },
        );
      }
      console.error("[beacon/pair] save failed:", error?.message);
      return NextResponse.json({ error: "Could not save device" }, { status: 500 });
    }

    const commands = pairingCommands({
      gatewayHost: process.env.BEACON_GATEWAY_HOST || "SET-BEACON_GATEWAY_HOST",
      gatewayPort: Number(process.env.BEACON_GATEWAY_PORT || 7018),
      family1Phone,
      family2Phone,
      sosPhone: family1Phone,
      volume: 1,
    });

    return NextResponse.json({ device, commands });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
