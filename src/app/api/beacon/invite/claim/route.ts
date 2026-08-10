import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";
import { sendPushToUser } from "../../../_firebaseAdmin";
import { isRateLimitedDurable } from "../../../_rateLimit";

// Claim a Beacon invite: the signed-in caller becomes a viewer of the
// invite's device. The token is the whole authorization, so claiming is
// atomic on status='pending' and the token burns on first use.

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { token } = await req.json();
    const clean = String(token ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(clean)) {
      return NextResponse.json({ error: "That invite link is not valid" }, { status: 400 });
    }

    // A guess cap: tokens are UUIDs, but there is no reason to allow
    // someone to try thousands of them.
    if (await isRateLimitedDurable(`beacon-claim:${user.id}`, 10, 3600)) {
      return NextResponse.json({ error: "Too many attempts. Try later." }, { status: 429 });
    }

    // Burn the token atomically.
    const { data: invite } = await supabaseAdmin
      .from("beacon_invites")
      .update({ status: "claimed", claimed_by: user.id, claimed_at: new Date().toISOString() })
      .eq("id", clean)
      .eq("status", "pending")
      .select("id, device_id, created_by, invitee_label")
      .maybeSingle();
    if (!invite) {
      return NextResponse.json(
        { error: "This invite has already been used or was withdrawn" },
        { status: 410 },
      );
    }

    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id, user_id, wearer_name, name, status")
      .eq("id", invite.device_id)
      .neq("status", "unpaired")
      .maybeSingle();
    if (!device) {
      return NextResponse.json({ error: "This Beacon is no longer active" }, { status: 410 });
    }
    if (device.user_id === user.id) {
      return NextResponse.json({ error: "You already host this Beacon" }, { status: 400 });
    }

    await supabaseAdmin.from("beacon_viewers").upsert(
      {
        device_id: device.id,
        viewer_user_id: user.id,
        granted_by: invite.created_by,
      },
      { onConflict: "device_id,viewer_user_id" },
    );

    // Tell the host their invite landed.
    const { data: claimer } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single();
    const wearer = device.wearer_name || device.name || "the Beacon";
    const claimerName = claimer?.full_name || "Someone";
    const body =
      `${claimerName} accepted the invite` +
      (invite.invitee_label ? ` (${invite.invitee_label})` : "") +
      ` and can now see ${wearer}'s Beacon.`;
    await supabaseAdmin.from("notifications").insert({
      user_id: invite.created_by,
      type: "system",
      title: "Beacon invite accepted",
      body,
      data: { type: "beacon_invite_claimed", device_id: device.id },
      is_read: false,
    });
    await sendPushToUser({
      userId: invite.created_by,
      title: "Beacon invite accepted",
      body,
      data: { type: "beacon_invite_claimed", device_id: device.id },
    }).catch(() => {});

    return NextResponse.json({ ok: true, wearerName: device.wearer_name || device.name });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not claim the invite" }, { status: 500 })
    );
  }
}
