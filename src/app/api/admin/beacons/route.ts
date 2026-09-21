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
        "id, device_id, name, wearer_name, wearer_color, status, battery_pct, last_lat, last_lng, last_fix_at, last_seen_at, active_sos_alert_id, share_with_contacts, user_id, created_at"
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

    // Sharing graph: explicit viewer grants (Beacon Circle) and the
    // legacy per-person exclusions, names resolved in one batch.
    const deviceIds = (devices || []).map((d) => d.id);
    const [{ data: grants }, { data: hidden }] = await Promise.all([
      deviceIds.length
        ? supabaseAdmin
            .from("beacon_viewers")
            .select("device_id, viewer_user_id, created_at")
            .in("device_id", deviceIds)
        : Promise.resolve({ data: [] as { device_id: string; viewer_user_id: string; created_at: string }[] }),
      deviceIds.length
        ? supabaseAdmin
            .from("device_hidden_contacts")
            .select("device_id, contact_user_id")
            .in("device_id", deviceIds)
        : Promise.resolve({ data: [] as { device_id: string; contact_user_id: string }[] }),
    ]);
    const peopleIds = [
      ...new Set([
        ...(grants || []).map((g) => g.viewer_user_id),
        ...(hidden || []).map((h) => h.contact_user_id),
      ]),
    ];
    const { data: people } = peopleIds.length
      ? await supabaseAdmin.from("users").select("id, full_name").in("id", peopleIds)
      : { data: [] };
    const nameOf = new Map((people || []).map((u) => [u.id, u.full_name || "Unknown"]));
    const grantsBy = new Map<string, { name: string; granted_at: string }[]>();
    for (const g of grants || []) {
      (grantsBy.get(g.device_id) ?? grantsBy.set(g.device_id, []).get(g.device_id)!)?.push({
        name: nameOf.get(g.viewer_user_id) || "Unknown",
        granted_at: g.created_at,
      });
    }
    const hiddenBy = new Map<string, string[]>();
    for (const h of hidden || []) {
      (hiddenBy.get(h.device_id) ?? hiddenBy.set(h.device_id, []).get(h.device_id)!)?.push(
        nameOf.get(h.contact_user_id) || "Unknown",
      );
    }

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
        wearer_name: d.wearer_name || null,
        wearer_color: d.wearer_color || null,
        share_with_contacts: Boolean(d.share_with_contacts),
        owner_id: d.user_id,
        owner_name: ownerById.get(d.user_id)?.full_name || "Unknown",
        owner_avatar: ownerById.get(d.user_id)?.avatar_url || null,
        shared_with: grantsBy.get(d.id) || [],
        hidden_from: hiddenBy.get(d.id) || [],
      })),
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: (error as Error).message === "Admin required" ? 403 : 500 })
    );
  }
}
