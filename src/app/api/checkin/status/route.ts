import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser } from "../../_auth";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { data: checkin } = await supabaseAdmin
      .from("safety_checkins")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["active", "missed"])
      .maybeSingle();

    if (!checkin) {
      return NextResponse.json({ active: false });
    }

    const now = new Date();
    const nextCheckIn = new Date(checkin.next_check_in_at);
    const isOverdue = now > nextCheckIn;

    if (isOverdue && checkin.status === "active") {
      const newMissedCount = (checkin.missed_count || 0) + 1;
      await supabaseAdmin
        .from("safety_checkins")
        .update({
          status: "missed",
          missed_count: newMissedCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkin.id);

      const { data: userData } = await supabaseAdmin
        .from("users")
        .select("full_name")
        .eq("id", user.id)
        .single();

      const userName = userData?.full_name || "Your contact";

      const notifications = (checkin.contact_ids || []).map((contactId: string) => ({
        user_id: contactId,
        type: "system",
        title: "Missed Check-In",
        body: `${userName} missed their check-in. Try reaching out to them. Their location is still being shared.`,
        data: {
          type: "safety_checkin_missed",
          checkin_id: checkin.id,
          user_id: user.id,
          user_name: userName,
          missed_count: newMissedCount,
        },
        is_read: false,
      }));

      if (notifications.length > 0) {
        await supabaseAdmin.from("notifications").insert(notifications);
      }

      await supabaseAdmin.from("notifications").insert({
        user_id: user.id,
        type: "system",
        title: "Check-In Expired",
        body: "Your safety check-in timer has expired. Your emergency contacts have been notified. Open Peja and tap 'I'm OK' to confirm you're safe.",
        data: {
          type: "safety_checkin_self_expired",
          checkin_id: checkin.id,
        },
        is_read: false,
      });

      return NextResponse.json({
        active: true,
        checkin: { ...checkin, status: "missed", missed_count: newMissedCount },
        isOverdue: true,
      });
    }

    return NextResponse.json({
      active: true,
      checkin,
      isOverdue,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
  }
}