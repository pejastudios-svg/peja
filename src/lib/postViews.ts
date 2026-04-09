import { supabase } from "@/lib/supabase";

// Track views recorded this session to avoid redundant DB calls
const sessionViews = new Set<string>();

/**
 * Record a unique view for a post. One user can only have one view per post.
 * Safe to call multiple times - deduplicates both client-side and via DB constraint.
 */
export async function recordPostView(postId: string, userId: string | undefined) {
  if (!postId || !userId) return;
  
  const key = `${postId}:${userId}`;
  if (sessionViews.has(key)) return;
  sessionViews.add(key);

  try {
    const { error } = await supabase
      .from("post_views")
      .upsert(
        { post_id: postId, user_id: userId },
        { onConflict: "post_id,user_id" }
      );

    if (!error) {
      // Update the cached view count on the post
      const { count } = await supabase
        .from("post_views")
        .select("id", { count: "exact", head: true })
        .eq("post_id", postId);

      if (count !== null) {
        await supabase
          .from("posts")
          .update({ views: count })
          .eq("id", postId);
      }
    }
  } catch {}
}