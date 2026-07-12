import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

/**
 * Admin map: all paired Beacon trackers with their latest telemetry.
 * SIM numbers are deliberately NOT returned (treated as secrets - anyone
 * who knows one can reconfigure that device by SMS).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { data: devices, error } = await supabaseAdmin
      .from("devices")
      .select(
        "id, device_id, name, status, battery_pct, last_lat, last_lng, last_fix_at, last_seen_at, active_sos_alert_id, user_id"
      )
      .neq("status", "unpaired")
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ownerIds = [...new Set((devices || []).map((d) => d.user_id))];
    const { data: owners } = ownerIds.length
      ? await supabaseAdmin
          .from("users")
          .select("id, full_name, avatar_url")
          .in("id", ownerIds)
      : { data: [] };
    const ownerById = new Map((owners || []).map((u) => [u.id, u]));

    return NextResponse.json({
      beacons: (devices || []).map((d) => ({
        id: d.id,
        device_id: d.device_id,
        name: d.name,
        status: d.status,
        battery_pct: d.battery_pct,
        last_lat: d.last_lat,
        last_lng: d.last_lng,
        last_fix_at: d.last_fix_at,
        last_seen_at: d.last_seen_at,
        sos_active: Boolean(d.active_sos_alert_id),
        owner_name: ownerById.get(d.user_id)?.full_name || "Unknown",
        owner_avatar: ownerById.get(d.user_id)?.avatar_url || null,
      })),
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: (error as Error).message === "Admin required" ? 403 : 500 })
    );
  }
}
