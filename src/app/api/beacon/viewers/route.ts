import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";

// Per-device viewer grants: the people who can see one hosted Beacon.
// Family case: mom grants dad each child's device. School case: the school
// grants each parent exactly their child's device. Every route checks the
// caller OWNS the device, so a viewer can never widen their own access.

async function requireOwnedDevice(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  deviceId: string,
) {
  const { data } = await supabaseAdmin
    .from("devices")
    .select("id, wearer_name, name")
    .eq("id", deviceId)
    .eq("user_id", userId)
    .neq("status", "unpaired")
    .maybeSingle();
  return data;
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const deviceId = req.nextUrl.searchParams.get("deviceId") || "";
    const device = await requireOwnedDevice(supabaseAdmin, user.id, deviceId);
    if (!device) return NextResponse.json({ error: "Not your Beacon" }, { status: 403 });

    const [{ data: grants }, { data: invites }] = await Promise.all([
      supabaseAdmin
        .from("beacon_viewers")
        .select("viewer_user_id, created_at, users:viewer_user_id (full_name, avatar_url)")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("beacon_invites")
        .select("id, invitee_label, status, created_at")
        .eq("device_id", deviceId)
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
    ]);

    return NextResponse.json({
      viewers: (grants || []).map((g: any) => ({
        userId: g.viewer_user_id,
        fullName: g.users?.full_name || "Someone",
        avatarUrl: g.users?.avatar_url || null,
        since: g.created_at,
      })),
      pendingInvites: invites || [],
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not load viewers" }, { status: 500 })
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { deviceId, viewerUserId } = await req.json();
    const device = await requireOwnedDevice(supabaseAdmin, user.id, deviceId);
    if (!device) return NextResponse.json({ error: "Not your Beacon" }, { status: 403 });
    if (!viewerUserId || viewerUserId === user.id) {
      return NextResponse.json({ error: "Pick a person to add" }, { status: 400 });
    }

    const { data: viewer } = await supabaseAdmin
      .from("users")
      .select("id, full_name")
      .eq("id", viewerUserId)
      .maybeSingle();
    if (!viewer) return NextResponse.json({ error: "That person is not on peja" }, { status: 404 });

    const { error } = await supabaseAdmin.from("beacon_viewers").upsert(
      {
        device_id: deviceId,
        viewer_user_id: viewerUserId,
        granted_by: user.id,
      },
      { onConflict: "device_id,viewer_user_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const wearer = device.wearer_name || device.name || "a Beacon";
    const { data: host } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single();
    const hostName = host?.full_name || "Someone";
    await supabaseAdmin.from("notifications").insert({
      user_id: viewerUserId,
      type: "system",
      title: "Beacon shared with you",
      body: `${hostName} shared ${wearer}'s Beacon with you. You can now see it on your map.`,
      data: { type: "beacon_viewer_granted", device_id: deviceId },
      is_read: false,
    });
    await sendPushToUser({
      userId: viewerUserId,
      title: "Beacon shared with you",
      body: `${hostName} shared ${wearer}'s Beacon with you. You can now see it on your map.`,
      data: { type: "beacon_viewer_granted", device_id: deviceId },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not add the viewer" }, { status: 500 })
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { deviceId, viewerUserId } = await req.json();
    const device = await requireOwnedDevice(supabaseAdmin, user.id, deviceId);
    if (!device) return NextResponse.json({ error: "Not your Beacon" }, { status: 403 });

    await supabaseAdmin
      .from("beacon_viewers")
      .delete()
      .eq("device_id", deviceId)
      .eq("viewer_user_id", viewerUserId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not remove the viewer" }, { status: 500 })
    );
  }
}
