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
      .select("id, last_confirmed_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!checkin) {
      return NextResponse.json({ ok: true });
    }

    // Deduplicate: cron may have already sent the warning for this interval
    const { data: existingWarn } = await supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("user_id", user.id)
      .filter("data->>type", "eq", "safety_checkin_warning")
      .filter("data->>checkin_id", "eq", checkin.id)
      .gte("created_at", checkin.last_confirmed_at)
      .maybeSingle();

    if (existingWarn) {
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