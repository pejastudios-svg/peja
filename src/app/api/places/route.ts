import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../_auth";

// Saved places: list mine, create one. A place can belong to the account
// itself (device_id null) or to one of the account's hosted Beacons.

const KINDS = ["home", "school", "work", "lesson", "custom"] as const;

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { data } = await supabaseAdmin
      .from("places")
      .select("*")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: true });
    return NextResponse.json({ places: data || [] });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not load places" }, { status: 500 })
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { label, kind, lat, lng, radiusM, addressText, deviceId, visibleToCircle } =
      await req.json();

    const cleanLabel = String(label ?? "").trim();
    if (!cleanLabel || cleanLabel.length > 60) {
      return NextResponse.json({ error: "Give the place a name" }, { status: 400 });
    }
    if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ error: "Pick a point on the map" }, { status: 400 });
    }
    const radius = Math.min(500, Math.max(100, Math.round(Number(radiusM) || 150)));
    const cleanKind = KINDS.includes(kind) ? kind : "custom";

    // A place attached to a Beacon must be one of the caller's own devices.
    if (deviceId) {
      const { data: device } = await supabaseAdmin
        .from("devices")
        .select("id")
        .eq("id", deviceId)
        .eq("user_id", user.id)
        .neq("status", "unpaired")
        .maybeSingle();
      if (!device) {
        return NextResponse.json({ error: "That Beacon is not yours" }, { status: 403 });
      }
    }

    // Soft cap per subject so the fence evaluator stays cheap.
    let countQuery = supabaseAdmin
      .from("places")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", user.id);
    countQuery = deviceId
      ? countQuery.eq("device_id", deviceId)
      : countQuery.is("device_id", null);
    const { count } = await countQuery;
    if ((count ?? 0) >= 20) {
      return NextResponse.json(
        { error: "You have reached the limit of 20 places" },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("places")
      .insert({
        owner_user_id: user.id,
        device_id: deviceId || null,
        label: cleanLabel,
        kind: cleanKind,
        lat,
        lng,
        radius_m: radius,
        address_text: addressText ? String(addressText).slice(0, 200) : null,
        visible_to_circle: visibleToCircle !== false,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, place: data });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not save the place" }, { status: 500 })
    );
  }
}
