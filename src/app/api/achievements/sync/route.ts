import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { award, awardCommunityBadges } from "../../_achievements";

/**
 * Recompute every badge that's derivable from current state. Idempotent
 * and cheap; called occasionally from the client (community page mount).
 * Covers first_light (needs profile + presence, no single event hook)
 * and self-heals any award a hook might have missed.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const [{ data: profile }, { data: presence }, { count: checkins }, { count: doneCheckins }, { count: reports }] =
      await Promise.all([
        supabaseAdmin.from("users").select("full_name, avatar_url, phone").eq("id", user.id).single(),
        supabaseAdmin.from("presence").select("user_id").eq("user_id", user.id).maybeSingle(),
        supabaseAdmin
          .from("safety_checkins")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabaseAdmin
          .from("safety_checkins")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "cancelled"),
        supabaseAdmin
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
      ]);

    if (profile?.full_name && profile?.phone && presence) {
      await award(supabaseAdmin, user.id, "first_light");
    }
    if ((checkins ?? 0) > 0) await award(supabaseAdmin, user.id, "always_ready");
    if ((doneCheckins ?? 0) > 0) await award(supabaseAdmin, user.id, "night_watch");
    if ((reports ?? 0) > 0) await award(supabaseAdmin, user.id, "lookout");
    await awardCommunityBadges(supabaseAdmin, user.id);

    // Guardian: do I protect anyone?
    const { count: protecting } = await supabaseAdmin
      .from("emergency_contacts")
      .select("id", { count: "exact", head: true })
      .eq("contact_user_id", user.id)
      .eq("status", "accepted");
    if ((protecting ?? 0) > 0) await award(supabaseAdmin, user.id, "guardian");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
