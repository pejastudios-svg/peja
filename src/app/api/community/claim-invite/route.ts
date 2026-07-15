import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";

/**
 * Claim a community invite (peja.life/join?ref=...). Creates the pending
 * emergency-contact request FROM the referrer TO the newly joined user,
 * so the existing accept/decline flow takes over from here.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const body = await req.json();
    const ref = String(body.ref ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(ref)) {
      return NextResponse.json({ error: "Invalid invite" }, { status: 400 });
    }
    if (ref === user.id) {
      return NextResponse.json({ claimed: false, reason: "self" });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: referrer } = await supabaseAdmin
      .from("users")
      .select("id, full_name")
      .eq("id", ref)
      .maybeSingle();
    if (!referrer) {
      return NextResponse.json({ claimed: false, reason: "unknown_referrer" });
    }

    // Dedupe: any existing relationship in this direction wins.
    const { data: existing } = await supabaseAdmin
      .from("emergency_contacts")
      .select("id, status")
      .eq("user_id", ref)
      .eq("contact_user_id", user.id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        claimed: true,
        already: true,
        referrer_name: referrer.full_name,
      });
    }

    const { error } = await supabaseAdmin.from("emergency_contacts").insert({
      user_id: ref,
      contact_user_id: user.id,
      relationship: "friend",
      status: "pending",
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Tell the referrer their invite worked - this is the reward moment
    // that makes people send more invites.
    const { data: joiner } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single();
    const joinerName = joiner?.full_name || "Someone you invited";
    await supabaseAdmin.from("notifications").insert({
      user_id: ref,
      type: "system",
      title: "Your invite worked",
      body: `${joinerName} joined peja from your invite. Once they accept, they'll be part of your circle.`,
      data: { type: "invite_joined", user_id: user.id },
      is_read: false,
    });
    sendPushToUser({
      userId: ref,
      title: "Your invite worked",
      body: `${joinerName} joined peja from your invite.`,
      data: { type: "invite_joined" },
    }).catch(() => {});

    return NextResponse.json({ claimed: true, referrer_name: referrer.full_name });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
