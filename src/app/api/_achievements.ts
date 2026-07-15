import type { SupabaseClient } from "@supabase/supabase-js";
import { ACHIEVEMENT_BY_KEY } from "@/lib/achievements";
import { sendPushToUser } from "./_firebaseAdmin";

/**
 * Idempotent badge award. First unlock inserts the row and queues the
 * celebration (an unread notification the AchievementCelebration
 * component turns into confetti); repeat calls are no-ops. Never throws -
 * a failed award must never break the safety action that triggered it.
 */
export async function award(
  supabaseAdmin: SupabaseClient,
  userId: string,
  key: string
): Promise<boolean> {
  try {
    const def = ACHIEVEMENT_BY_KEY.get(key);
    if (!def) return false;

    const { data, error } = await supabaseAdmin
      .from("user_achievements")
      .upsert({ user_id: userId, key }, { onConflict: "user_id,key", ignoreDuplicates: true })
      .select("key");
    if (error || !data || data.length === 0) return false; // already had it

    await supabaseAdmin.from("notifications").insert({
      user_id: userId,
      type: "system",
      title: `Badge unlocked: ${def.name}`,
      body: def.description,
      data: { type: "achievement_unlocked", key },
      is_read: false,
    });
    sendPushToUser({
      userId,
      title: `Badge unlocked: ${def.name}`,
      body: def.description,
      data: { type: "achievement_unlocked", key },
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Award the community-size badges for a user based on their current
 * accepted contact count. Called after any accept event.
 */
export async function awardCommunityBadges(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<void> {
  try {
    const { count } = await supabaseAdmin
      .from("emergency_contacts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "accepted");
    const n = count ?? 0;
    if (n >= 1) await award(supabaseAdmin, userId, "circle_starter");
    if (n >= 3) await award(supabaseAdmin, userId, "community_builder");
    if (n >= 5) await award(supabaseAdmin, userId, "circle_trust");
  } catch {
    /* never break the caller */
  }
}
