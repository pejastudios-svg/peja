import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser } from "../../_auth";
import { sendPushToUser } from "../../_firebaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { contactIds, intervalMinutes } = await req.json();

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return NextResponse.json({ error: "Select at least one contact" }, { status: 400 });
    }

    if (!intervalMinutes || intervalMinutes < 15 || intervalMinutes > 1440) {
      return NextResponse.json({ error: "Interval must be between 15 minutes and 24 hours" }, { status: 400 });
    }

    // Check for existing active check-in
    const { data: existing } = await supabaseAdmin
      .from("safety_checkins")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "You already have an active check-in. Cancel it first." }, { status: 400 });
    }

    // Verify all contacts are accepted emergency contacts
    const { data: validContacts } = await supabaseAdmin
      .from("emergency_contacts")
      .select("contact_user_id")
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .in("contact_user_id", contactIds);

    const validIds = (validContacts || []).map((c: any) => c.contact_user_id);
    if (validIds.length === 0) {
      return NextResponse.json({ error: "No valid accepted contacts selected" }, { status: 400 });
    }

    // Get user's current location if available
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single();

    const nextCheckIn = new Date(Date.now() + intervalMinutes * 60000);

    // Create check-in
    const { data: checkin, error: insertError } = await supabaseAdmin
      .from("safety_checkins")
      .insert({
        user_id: user.id,
        status: "active",
        contact_ids: validIds,
        check_in_interval_minutes: intervalMinutes,
        next_check_in_at: nextCheckIn.toISOString(),
        last_confirmed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Notify all selected contacts
    const userName = userData?.full_name || "Someone";
    const notifications = validIds.map((contactId: string) => ({
      user_id: contactId,
      type: "system",
      title: "Safety Check-In Started",
      body: `${userName} is sharing their location with you. They will check in every ${intervalMinutes < 60 ? `${intervalMinutes} minutes` : `${Math.floor(intervalMinutes / 60)} hour${Math.floor(intervalMinutes / 60) > 1 ? "s" : ""}${intervalMinutes % 60 > 0 ? ` ${intervalMinutes % 60} min` : ""}`}.`,
      data: {
        type: "safety_checkin_started",
        checkin_id: checkin.id,
        user_id: user.id,
        user_name: userName,
      },
      is_read: false,
    }));

    await supabaseAdmin.from("notifications").insert(notifications);

    await Promise.all(validIds.map((contactId: string) =>
      sendPushToUser({
        userId: contactId,
        title: "Safety Check-In Started",
        body: `${userName} is sharing their location with you. They will check in every ${intervalMinutes < 60 ? `${intervalMinutes} minutes` : `${Math.floor(intervalMinutes / 60)} hour${Math.floor(intervalMinutes / 60) > 1 ? "s" : ""}${intervalMinutes % 60 > 0 ? ` ${intervalMinutes % 60} min` : ""}`}.`,
        data: { type: "safety_checkin_started", checkin_id: checkin.id, user_id: user.id },
      })
    ));

    return NextResponse.json({ ok: true, checkin });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || "Server error" }, { status: 500 });
  }
}