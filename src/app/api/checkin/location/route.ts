import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";
import { evaluateUserGeofences } from "../../_geofence";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { latitude, longitude, address, speed_kmh } = await req.json();

    // != null so a valid 0 coordinate isn't rejected as "missing".
    if (latitude == null || longitude == null) {
      return NextResponse.json({ error: "Missing coordinates" }, { status: 400 });
    }

    // Get active check-in (previous position too, for the stillness clock;
    // destination + audience for the geofence pass below)
    const { data: checkin } = await supabaseAdmin
      .from("safety_checkins")
      .select(
        "id, latitude, longitude, still_since, contact_ids, destination_place_id, destination_label, destination_lat, destination_lng, destination_radius_m, destination_pending_since, arrived_at",
      )
      .eq("user_id", user.id)
      .in("status", ["active", "missed"])
      .maybeSingle();

    if (!checkin) {
      return NextResponse.json({ error: "No active check-in" }, { status: 404 });
    }

    // Stillness: hasn't meaningfully moved (~30m covers GPS drift) since
    // the last update -> keep/start the clock; moved -> clear it. Native
    // Android updates bypass this route, so their still_since stays null.
    let stillSince: string | null = null;
    if (checkin.latitude != null && checkin.longitude != null) {
      const R = 6371000;
      const dLat = ((latitude - checkin.latitude) * Math.PI) / 180;
      const dLng = ((longitude - checkin.longitude) * Math.PI) / 180;
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((checkin.latitude * Math.PI) / 180) *
          Math.cos((latitude * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const distM = 2 * R * Math.asin(Math.sqrt(h));
      if (distM < 30) stillSince = checkin.still_since || new Date().toISOString();
    }

    const speed =
      typeof speed_kmh === "number" && Number.isFinite(speed_kmh) && speed_kmh >= 0 && speed_kmh <= 300
        ? Math.round(speed_kmh * 10) / 10
        : null;

    // Update location
    await supabaseAdmin
      .from("safety_checkins")
      .update({
        latitude,
        longitude,
        address: address || null,
        speed_kmh: speed,
        still_since: stillSince,
        location_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkin.id);

    // Geofences: destination arrival + saved-place enter/leave, told to the
    // same people the session is shared with. Never allowed to fail the
    // location write, a fence bug must not stop tracking.
    try {
      const { data: userData } = await supabaseAdmin
        .from("users")
        .select("full_name")
        .eq("id", user.id)
        .single();
      await evaluateUserGeofences(supabaseAdmin, {
        userId: user.id,
        userName: userData?.full_name || "Someone",
        audienceUserIds: (checkin.contact_ids as string[]) || [],
        lat: latitude,
        lng: longitude,
        checkin,
      });
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ ok: false, error: error.message || "Server error" }, { status: 500 })
    );
  }
}