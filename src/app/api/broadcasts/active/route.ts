import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

/**
 * The popup a signed-in user has not seen yet, if there is one.
 *
 * Pull rather than push, which is what makes popups self-correcting: the
 * audience filter is re-checked against this user at the moment they open
 * the app. A "you have no recovery codes" popup therefore stops appearing
 * the instant they set some up, with nothing to clean up afterwards.
 *
 * Only one is ever returned. Stacking cards on launch is how an app gets
 * dismissed without being read.
 */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { data: live } = await supabaseAdmin
      .from("broadcasts")
      .select("id, title, body, resource_text, action_url, audience")
      .eq("delivery", "popup")
      .eq("status", "sent")
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!live || live.length === 0) return NextResponse.json({ ok: true, broadcast: null });

    const { data: seen } = await supabaseAdmin
      .from("broadcast_dismissals")
      .select("broadcast_id")
      .eq("user_id", user.id)
      .in("broadcast_id", live.map((b) => b.id));
    const dismissed = new Set((seen || []).map((d) => d.broadcast_id));

    // Newest first, so the most recent relevant message wins. The audience
    // check is a per-user function, not a scan of everyone.
    for (const b of live) {
      if (dismissed.has(b.id)) continue;
      const { data: matches } = await supabaseAdmin.rpc("broadcast_matches", {
        p_user: user.id,
        p_audience: b.audience,
      });
      if (matches === true) {
        return NextResponse.json({
          ok: true,
          broadcast: {
            id: b.id,
            title: b.title,
            body: b.body,
            resourceText: b.resource_text,
            actionUrl: b.action_url,
          },
        });
      }
    }

    return NextResponse.json({ ok: true, broadcast: null });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { broadcastId } = await req.json();
    if (!broadcastId) {
      return NextResponse.json({ error: "broadcastId required" }, { status: 400 });
    }
    const supabaseAdmin = getSupabaseAdmin();
    // Upsert: closing the same card twice is a no-op rather than an error.
    await supabaseAdmin
      .from("broadcast_dismissals")
      .upsert(
        { broadcast_id: broadcastId, user_id: user.id },
        { onConflict: "broadcast_id,user_id" },
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ?? NextResponse.json({ error: "Failed" }, { status: 500 })
    );
  }
}
