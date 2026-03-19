import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser } from "../../_auth";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { latitude, longitude, address } = await req.json();

    // Get active OR missed check-in
    const { data: checkin } = await supabaseAdmin
      .from("safety_checkins")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "missed"])
      .maybeSingle();

    if (!checkin) {
      return NextResponse.json({ error: "No active check-in found" }, { status: 404 });
    }

    const nextCheckIn = new Date(Date.now() + checkin.check_in_interval_minutes * 60000);
    const wasMissed = checkin.status === "missed";

    // Update check-in
    const updateData: any = {
      status: "active",
      last_confirmed_at: new Date().toISOString(),
      next_check_in_at: nextCheckIn.toISOString(),
      missed_count: 0,
      updated_at: new Date().toISOString(),
    };

    if (latitude && longitude) {
      updateData.latitude = latitude;
      updateData.longitude = longitude;
      updateData.location_updated_at = new Date().toISOString();
    }
    if (address) {
      updateData.address = address;
    }

    await supabaseAdmin
      .from("safety_checkins")
      .update(updateData)
      .eq("id", checkin.id);

    // Get user name
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single();

    const userName = userData?.full_name || "Your contact";

    // Notify contacts that user confirmed
    const notifications = (checkin.contact_ids || []).map((contactId: string) => ({
      user_id: contactId,
      type: "system",
      title: wasMissed ? "Check-In Confirmed" : "Check-In OK",
      body: wasMissed
        ? `${userName} has confirmed they are okay. Timer has been reset.`
        : `${userName} checked in and is okay.`,
      data: {
        type: "safety_checkin_confirmed",
        checkin_id: checkin.id,
        user_id: user.id,
        user_name: userName,
      },
      is_read: false,
    }));

    if (notifications.length > 0) {
      await supabaseAdmin.from("notifications").insert(notifications);
    }

    return NextResponse.json({ ok: true, nextCheckInAt: nextCheckIn.toISOString() });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || "Server error" }, { status: 500 });
  }
}