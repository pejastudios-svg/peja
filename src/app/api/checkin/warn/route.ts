import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser } from "../../_auth";
import { sendPushToUser } from "../../_firebaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    // Check active check-in exists
    const { data: checkin } = await supabaseAdmin
      .from("safety_checkins")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!checkin) {
      return NextResponse.json({ ok: true });
    }

    // Send self-notification
    await supabaseAdmin.from("notifications").insert({
      user_id: user.id,
      type: "system",
      title: "Check-In Expiring Soon",
      body: "Your safety check-in expires in less than 5 minutes. Tap 'I'm OK' to reset the timer.",
      data: {
        type: "safety_checkin_warning",
        checkin_id: checkin.id,
      },
      is_read: false,
    });

    await sendPushToUser({
      userId: user.id,
      title: "Check-In Expiring Soon",
      body: "Your safety check-in expires in less than 5 minutes. Tap 'I'm OK' to reset the timer.",
      data: { type: "safety_checkin_warning", checkin_id: checkin.id },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}