import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { latitude, longitude, address } = await req.json();

    // != null so a valid 0 coordinate isn't rejected as "missing".
    if (latitude == null || longitude == null) {
      return NextResponse.json({ error: "Missing coordinates" }, { status: 400 });
    }

    // Get active check-in
    const { data: checkin } = await supabaseAdmin
      .from("safety_checkins")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["active", "missed"])
      .maybeSingle();

    if (!checkin) {
      return NextResponse.json({ error: "No active check-in" }, { status: 404 });
    }

    // Update location
    await supabaseAdmin
      .from("safety_checkins")
      .update({
        latitude,
        longitude,
        address: address || null,
        location_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkin.id);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ ok: false, error: error.message || "Server error" }, { status: 500 })
    );
  }
}