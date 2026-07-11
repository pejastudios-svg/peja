import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { canUseBeacon, settingsCommands } from "@/lib/beacon";

/**
 * Update a paired Beacon's settings. App-side toggles (fall alerts, ack
 * tone, name) apply instantly; hardware settings (volume, contacts,
 * intercom) also return the SMS commands that must reach the device.
 */
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
      .select("id, user_id, volume, family1_contact_id, family2_contact_id, intercom_enabled")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const cmdChanges: Parameters<typeof settingsCommands>[0] = {};

    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 40);
    if (typeof body.fall_alert_enabled === "boolean") patch.fall_alert_enabled = body.fall_alert_enabled;
    if (typeof body.sos_ack_tone === "boolean") patch.sos_ack_tone = body.sos_ack_tone;

    if (typeof body.volume === "number" && body.volume >= 0 && body.volume <= 4) {
      patch.volume = Math.round(body.volume);
      if (patch.volume !== device.volume) cmdChanges.volume = patch.volume as number;
    }
    if (typeof body.intercom_enabled === "boolean" && body.intercom_enabled !== device.intercom_enabled) {
      patch.intercom_enabled = body.intercom_enabled;
      cmdChanges.intercomEnabled = body.intercom_enabled;
    }

    // Contact changes: resolve to phones, keep sos target = contact 1.
    const contactsChanged =
      body.family1_contact_id !== undefined || body.family2_contact_id !== undefined;
    if (contactsChanged) {
      const f1 = body.family1_contact_id ?? device.family1_contact_id;
      const f2 = body.family2_contact_id ?? device.family2_contact_id;

      async function phoneFor(contactId: string | null): Promise<string | null> {
        if (!contactId) return null;
        const { data: c } = await supabaseAdmin
          .from("emergency_contacts")
          .select("contact_user_id, user_id, status")
          .eq("id", contactId)
          .eq("user_id", user.id)
          .eq("status", "accepted")
          .maybeSingle();
        if (!c?.contact_user_id) return null;
        const { data: u } = await supabaseAdmin
          .from("users").select("phone").eq("id", c.contact_user_id).single();
        return u?.phone || null;
      }

      const [p1, p2] = await Promise.all([phoneFor(f1), phoneFor(f2)]);
      if (f1 && !p1) {
        return NextResponse.json({ error: "Contact 1 has no phone number" }, { status: 400 });
      }
      patch.family1_contact_id = p1 ? f1 : null;
      patch.family2_contact_id = p2 ? f2 : null;
      patch.sos_msisdn = p1;
      cmdChanges.family1Phone = p1;
      cmdChanges.family2Phone = p2;
      cmdChanges.sosPhone = p1;
    }

    const { data: updated, error } = await supabaseAdmin
      .from("devices")
      .update(patch)
      .eq("id", device.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ device: updated, commands: settingsCommands(cmdChanges) });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
