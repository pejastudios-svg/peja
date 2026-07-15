import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

/**
 * "Share my location with [name]" toggle (PEJA_MAP_HOME_DESIGN.md §3).
 * Sharing MY location with a peer can flow through two rows:
 *  - row(peer, me):  I'm their protector -> my `share_back` flag
 *  - row(me, peer):  they're my protector -> my `hide_from_contact` flag
 * Pausing flips both paths off; enabling flips both on. One honest
 * switch, no matter how the relationship was formed.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const body = await req.json();
    const peerId = String(body.peerId ?? "");
    const share = Boolean(body.share);
    if (!/^[0-9a-f-]{36}$/i.test(peerId) || peerId === user.id) {
      return NextResponse.json({ error: "Invalid peer" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const [asProtector, asOwner] = await Promise.all([
      supabaseAdmin
        .from("emergency_contacts")
        .update({ share_back: share })
        .eq("user_id", peerId)
        .eq("contact_user_id", user.id)
        .eq("status", "accepted")
        .select("id"),
      supabaseAdmin
        .from("emergency_contacts")
        .update({ hide_from_contact: !share })
        .eq("user_id", user.id)
        .eq("contact_user_id", peerId)
        .eq("status", "accepted")
        .select("id"),
    ]);

    const touched = (asProtector.data?.length ?? 0) + (asOwner.data?.length ?? 0);
    if (touched === 0) {
      return NextResponse.json({ error: "Not in each other's circle" }, { status: 403 });
    }

    return NextResponse.json({ ok: true, sharing: share });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
