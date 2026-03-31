import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser } from "../../_auth";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const checkinId = req.nextUrl.searchParams.get("id");
    if (!checkinId) {
      return NextResponse.json({ error: "Missing checkin id" }, { status: 400 });
    }

    // Get the check-in (must be active/missed and user must be in contact_ids)
    const { data: checkin } = await supabaseAdmin
      .from("safety_checkins")
      .select("*")
      .eq("id", checkinId)
      .in("status", ["active", "missed"])
      .maybeSingle();

    if (!checkin) {
      return NextResponse.json({ error: "Check-in not found or ended" }, { status: 404 });
    }

    // Verify the requesting user is in the contact list
    if (!checkin.contact_ids.includes(user.id)) {
      return NextResponse.json({ error: "Not authorized to view this check-in" }, { status: 403 });
    }

// Get the check-in owner's info (include fallback location)
    const { data: owner } = await supabaseAdmin
      .from("users")
      .select("id, full_name, avatar_url, last_latitude, last_longitude")
      .eq("id", checkin.user_id)
      .single();
    return NextResponse.json({
      ok: true,
      checkin: {
        id: checkin.id,
        status: checkin.status,
        latitude: checkin.latitude || owner?.last_latitude || null,
        longitude: checkin.longitude || owner?.last_longitude || null,
        address: checkin.address,
        location_updated_at: checkin.location_updated_at,
        next_check_in_at: checkin.next_check_in_at,
        last_confirmed_at: checkin.last_confirmed_at,
        missed_count: checkin.missed_count,
        check_in_interval_minutes: checkin.check_in_interval_minutes,
        created_at: checkin.created_at,
      },
      owner: owner || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
  }
}