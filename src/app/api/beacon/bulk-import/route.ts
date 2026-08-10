import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { canUseBeacon, parseDeviceId, pairingCommands, devicePhone } from "@/lib/beacon";

// Fleet onboarding: many Beacons in one request. Each valid row becomes a
// devices row plus a queued over-the-air config job; the checkin-monitor
// cron drains the queue inside the Termii budget, so a thousand-device
// import is a steady background chore, never a burst.
//
// Row shape: { deviceId, sim, wearerName, contactPhone? }
// contactPhone (a parent, a supervisor) becomes the device's call button 1
// and SOS number. Rows fail INDIVIDUALLY: one bad SIM must not sink the
// other 999.

const MAX_ROWS = 1000;

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!canUseBeacon(user.email)) {
      return NextResponse.json({ error: "Beacon is in a closed pilot" }, { status: 403 });
    }
    const supabaseAdmin = getSupabaseAdmin();
    const { rows } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Import at most ${MAX_ROWS} devices at a time` },
        { status: 400 },
      );
    }

    const gatewayHost = process.env.BEACON_GATEWAY_HOST || "";
    const gatewayPort = Number(process.env.BEACON_GATEWAY_PORT || 7018);

    const results: { row: number; ok: boolean; error?: string; deviceId?: string }[] = [];
    let queued = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const deviceId = parseDeviceId(String(r.deviceId ?? ""));
      const sim = String(r.sim ?? "").replace(/[^\d+]/g, "");
      const wearerName = String(r.wearerName ?? "").trim().slice(0, 40);
      const contactPhoneRaw = String(r.contactPhone ?? "").replace(/[^\d+]/g, "");

      if (!deviceId) {
        results.push({ row: i + 1, ok: false, error: "Bad device ID" });
        continue;
      }
      if (!/^(\+?234|0)\d{10}$/.test(sim)) {
        results.push({ row: i + 1, ok: false, error: "Bad SIM number" });
        continue;
      }
      if (!wearerName) {
        results.push({ row: i + 1, ok: false, error: "Missing wearer name" });
        continue;
      }
      const contactPhone =
        contactPhoneRaw && /^(\+?234|0)\d{10}$/.test(contactPhoneRaw)
          ? devicePhone(contactPhoneRaw)
          : null;

      // Same claim rules as single pairing: a device someone else holds
      // is not importable.
      const { data: existing } = await supabaseAdmin
        .from("devices")
        .select("id, user_id, status")
        .eq("device_id", deviceId)
        .maybeSingle();
      if (existing && existing.user_id !== user.id && existing.status !== "unpaired") {
        results.push({ row: i + 1, ok: false, error: "Paired to another account" });
        continue;
      }

      const row = {
        user_id: user.id,
        device_id: deviceId,
        sim_msisdn: sim,
        name: "Beacon 1",
        wearer_name: wearerName,
        wearer_color: "#8b5cf6",
        status: "configuring",
        sos_msisdn: contactPhone,
        volume: 1,
        updated_at: new Date().toISOString(),
      };
      const { data: device, error } = existing
        ? await supabaseAdmin.from("devices").update(row).eq("id", existing.id).select("id").single()
        : await supabaseAdmin.from("devices").insert(row).select("id").single();
      if (error || !device) {
        results.push({ row: i + 1, ok: false, error: "Could not save" });
        continue;
      }

      const commands = pairingCommands({
        gatewayHost: gatewayHost || "SET-BEACON_GATEWAY_HOST",
        gatewayPort,
        family1Phone: contactPhone,
        family2Phone: null,
        sosPhone: contactPhone,
        volume: 1,
      });
      await supabaseAdmin.from("beacon_config_jobs").insert({
        device_id: device.id,
        created_by: user.id,
        commands,
      });
      queued++;
      results.push({ row: i + 1, ok: true, deviceId });
    }

    return NextResponse.json({
      ok: true,
      queued,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Import failed" }, { status: 500 })
    );
  }
}

// Progress: how the caller's queued jobs are doing, for the "312 of 1000
// configured" line in the fleet UI.
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { data } = await supabaseAdmin
      .from("beacon_config_jobs")
      .select("status")
      .eq("created_by", user.id);
    const counts = { queued: 0, sending: 0, done: 0, failed: 0 };
    for (const j of data || []) counts[j.status as keyof typeof counts]++;
    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not load progress" }, { status: 500 })
    );
  }
}
