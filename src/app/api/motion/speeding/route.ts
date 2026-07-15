import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";
import { sendPushToUser } from "../../_firebaseAdmin";

// Speeding alert fan-out. The DEVICE detects speeding (it has the live
// GPS); this route notifies the driver plus everyone currently allowed
// to see their location. Server-side cooldown so a long drive can't
// spam anyone: at most one alert per driver per 10 minutes.

const COOLDOWN_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const { speed_kmh } = await req.json();
    const speed = Math.round(Number(speed_kmh));
    if (!Number.isFinite(speed) || speed < 80 || speed > 400) {
      return NextResponse.json({ error: "Implausible speed" }, { status: 400 });
    }

    // Server-side cooldown: has this driver triggered an alert recently?
    const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("user_id", user.id)
      .eq("data->>type", "speeding_self")
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      return NextResponse.json({ ok: true, throttled: true });
    }

    const { data: me } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single();
    const myName = (me?.full_name || "Someone").split(" ")[0];

    // Everyone allowed to see my location right now:
    //   my protectors (rows I own, accepted, not hidden), plus
    //   people I protect who I shared back with.
    const [protectorsRes, sharedBackRes] = await Promise.all([
      supabaseAdmin
        .from("emergency_contacts")
        .select("contact_user_id")
        .eq("user_id", user.id)
        .eq("status", "accepted")
        .eq("hide_from_contact", false),
      supabaseAdmin
        .from("emergency_contacts")
        .select("user_id")
        .eq("contact_user_id", user.id)
        .eq("status", "accepted")
        .eq("share_back", true),
    ]);
    const viewerIds = [
      ...new Set([
        ...(protectorsRes.data || []).map((r) => r.contact_user_id as string),
        ...(sharedBackRes.data || []).map((r) => r.user_id as string),
      ]),
    ].filter((id) => id !== user.id);

    const rows = [
      {
        user_id: user.id,
        type: "system",
        title: "Slow down",
        body: `You were doing ${speed} km/h. Please ease off, your people need you home.`,
        data: { type: "speeding_self", speed_kmh: speed },
        is_read: false,
      },
      ...viewerIds.map((id) => ({
        user_id: id,
        type: "system",
        title: `${myName} is driving fast`,
        body: `${myName} was doing ${speed} km/h just now. Maybe check in with them.`,
        data: { type: "speeding_circle", from_user_id: user.id, speed_kmh: speed },
        is_read: false,
      })),
    ];
    await supabaseAdmin.from("notifications").insert(rows);

    sendPushToUser({
      userId: user.id,
      title: "Slow down",
      body: `You were doing ${speed} km/h. Please ease off.`,
      data: { type: "speeding_self" },
    }).catch(() => {});
    for (const id of viewerIds) {
      sendPushToUser({
        userId: id,
        title: `${myName} is driving fast`,
        body: `${myName} was doing ${speed} km/h just now.`,
        data: { type: "speeding_circle", from_user_id: user.id },
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, notified: viewerIds.length });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
