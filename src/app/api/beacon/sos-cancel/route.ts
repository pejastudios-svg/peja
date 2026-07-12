import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { canUseBeacon } from "@/lib/beacon";

/**
 * Owner cancels their Beacon's active SOS from the dashboard. Mirrors the
 * in-app SOS cancel exactly: status -> cancelled + resolved_at, no extra
 * notifications (same as SOSButton's cancel).
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
      .select("id, user_id, active_sos_alert_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });
    if (!device.active_sos_alert_id) {
      return NextResponse.json({ ok: true, cancelled: false });
    }

    await supabaseAdmin
      .from("sos_alerts")
      .update({ status: "cancelled", resolved_at: new Date().toISOString() })
      .eq("id", device.active_sos_alert_id)
      .eq("user_id", user.id)
      .eq("status", "active");

    await supabaseAdmin
      .from("devices")
      .update({
        active_sos_alert_id: null,
        sos_escalated_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", device.id);

    return NextResponse.json({ ok: true, cancelled: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
