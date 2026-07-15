import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";
import { award } from "../../_achievements";

/**
 * "Ask to check in" - the smallest unit of care in the app.
 * mode "ask":   ping a circle member ("are you okay?")
 * mode "imok":  answer one ("[name] is OK") - the relief ping back.
 * Only allowed between users with an accepted contact relationship in
 * either direction.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const body = await req.json();
    const peerId = String(body.peerId ?? "");
    const mode = body.mode === "imok" ? "imok" : "ask";
    if (!/^[0-9a-f-]{36}$/i.test(peerId) || peerId === user.id) {
      return NextResponse.json({ error: "Invalid peer" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Gate: an accepted contact relationship (either direction) OR both
    // being accepted members of the same member-visible circle.
    const { data: rel } = await supabaseAdmin
      .from("emergency_contacts")
      .select("id")
      .eq("status", "accepted")
      .or(
        `and(user_id.eq.${user.id},contact_user_id.eq.${peerId}),and(user_id.eq.${peerId},contact_user_id.eq.${user.id})`
      )
      .limit(1);
    let allowed = Boolean(rel && rel.length > 0);
    if (!allowed) {
      const { data: shared } = await supabaseAdmin
        .from("contact_group_members")
        .select("group_id, contact_groups!inner(members_visible)")
        .eq("member_user_id", user.id)
        .eq("status", "accepted");
      const myVisibleGroups = (shared || [])
        .filter((r) => (r.contact_groups as unknown as { members_visible: boolean })?.members_visible)
        .map((r) => r.group_id);
      if (myVisibleGroups.length > 0) {
        const { data: peerIn } = await supabaseAdmin
          .from("contact_group_members")
          .select("group_id")
          .eq("member_user_id", peerId)
          .eq("status", "accepted")
          .in("group_id", myVisibleGroups)
          .limit(1);
        allowed = Boolean(peerIn && peerIn.length > 0);
      }
    }
    if (!allowed) {
      return NextResponse.json({ error: "Not in each other's circle" }, { status: 403 });
    }

    const { data: me } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single();
    const myName = me?.full_name || "Someone in your circle";

    const title = mode === "ask" ? "Are you okay?" : `${myName} is OK`;
    const bodyText =
      mode === "ask"
        ? `${myName} is checking on you. Tap I'm OK on your map to put their mind at ease.`
        : `${myName} says they're okay. You can breathe now.`;
    const data = {
      type: mode === "ask" ? "community_ping" : "community_ping_ok",
      from_user_id: user.id,
      from_name: myName,
    };

    await supabaseAdmin.from("notifications").insert({
      user_id: peerId,
      type: "system",
      title,
      body: bodyText,
      data,
      is_read: false,
    });
    sendPushToUser({
      userId: peerId,
      title,
      body: bodyText,
      data: { type: data.type, from_user_id: user.id },
    }).catch(() => {});

    if (mode === "imok") await award(supabaseAdmin, user.id, "first_responder");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
