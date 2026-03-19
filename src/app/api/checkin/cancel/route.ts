import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser } from "../../_auth";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    // Get active check-in
    const { data: checkin } = await supabaseAdmin
      .from("safety_checkins")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "missed"])
      .maybeSingle();

    if (!checkin) {
      return NextResponse.json({ error: "No active check-in found" }, { status: 404 });
    }

    // Cancel check-in
    await supabaseAdmin
      .from("safety_checkins")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkin.id);

    // Get user's name
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single();

    const userName = userData?.full_name || "Your contact";

    // Notify contacts
    const notifications = (checkin.contact_ids || []).map((contactId: string) => ({
      user_id: contactId,
      type: "system",
      title: "Check-In Ended",
      body: `${userName} has stopped sharing their location with you.`,
      data: {
        type: "safety_checkin_ended",
        checkin_id: checkin.id,
        user_id: user.id,
      },
      is_read: false,
    }));

    if (notifications.length > 0) {
      await supabaseAdmin.from("notifications").insert(notifications);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || "Server error" }, { status: 500 });
  }
}