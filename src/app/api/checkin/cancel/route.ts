import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";
import { award } from "../../_achievements";
import { sendPushToUser } from "../../_firebaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    // Optional body: offline-queued cancels carry the timestamp the
    // user actually tapped Stop. The route has no required body, so
    // parse failures just mean "no body".
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const triggeredAt =
      typeof body?.triggeredAt === "string" ? new Date(body.triggeredAt) : null;

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

    // Stale-cancel guard: a cancel queued offline in a previous session
    // must not kill a check-in that was started AFTER the user tapped
    // Stop. Ignore it as already-satisfied (its target no longer exists).
    if (
      triggeredAt &&
      !isNaN(triggeredAt.getTime()) &&
      new Date(checkin.created_at) > triggeredAt
    ) {
      await award(supabaseAdmin, user.id, "night_watch");

      return NextResponse.json({ ok: true, skipped: "stale_cancel" });
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
      await Promise.all((checkin.contact_ids || []).map((contactId: string) =>
        sendPushToUser({
          userId: contactId,
          title: "Check-In Ended",
          body: `${userName} has stopped sharing their location with you.`,
          data: { type: "safety_checkin_ended", checkin_id: checkin.id, user_id: user.id },
        })
      ));
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ ok: false, error: error.message || "Server error" }, { status: 500 })
    );
  }
}