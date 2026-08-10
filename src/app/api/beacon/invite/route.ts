import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";

// Create an invite link that grants ONE Beacon to whoever claims it.
// For viewers who are not on peja yet: the school hands a parent a link,
// the parent signs up, the claim converts to a beacon_viewers grant.
// The invite row's id IS the token; it never appears anywhere except in
// the link the host chooses to share.

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { deviceId, label } = await req.json();

    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id, wearer_name, name")
      .eq("id", deviceId)
      .eq("user_id", user.id)
      .neq("status", "unpaired")
      .maybeSingle();
    if (!device) return NextResponse.json({ error: "Not your Beacon" }, { status: 403 });

    // 30 invites/hour: room for a classroom, not for a spam cannon.
    if (await isRateLimitedDurable(`beacon-invite:${user.id}`, 30, 3600)) {
      return NextResponse.json(
        { error: "Too many invites. Wait a while and try again." },
        { status: 429 },
      );
    }

    const { data: invite, error } = await supabaseAdmin
      .from("beacon_invites")
      .insert({
        device_id: deviceId,
        created_by: user.id,
        invitee_label: label ? String(label).trim().slice(0, 60) : null,
      })
      .select("id")
      .single();
    if (error || !invite) {
      return NextResponse.json({ error: "Could not create the invite" }, { status: 500 });
    }

    const base = process.env.NEXT_PUBLIC_APP_URL || "https://peja.life";
    return NextResponse.json({
      ok: true,
      inviteId: invite.id,
      url: `${base}/beacon-invite/${invite.id}`,
      wearerName: device.wearer_name || device.name,
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not create the invite" }, { status: 500 })
    );
  }
}

// Revoke a pending invite.
export async function DELETE(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const { inviteId } = await req.json();
    await supabaseAdmin
      .from("beacon_invites")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("created_by", user.id)
      .eq("status", "pending");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not revoke the invite" }, { status: 500 })
    );
  }
}
