"use client";

// Silently pre-fetches data for profile, notifications, and messages
// so navigating to those pages is instant.
import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { useFeedCache } from "@/context/FeedContext";

export function BackgroundPrefetcher() {
  const { user, loading } = useAuth();
  const feedCache = useFeedCache();
  const ranRef = useRef(false);

  useEffect(() => {
    if (loading || !user?.id) return;
    if (ranRef.current) return;
    ranRef.current = true;

    // Run after a short idle so we don't compete with the home feed fetch
    const id = setTimeout(() => prefetch(user.id, feedCache), 2000);
    return () => clearTimeout(id);
  }, [loading, user?.id]);

  return null;
}

async function prefetch(userId: string, feedCache: ReturnType<typeof useFeedCache>) {
  // Profile posts (only if not already cached)
  if (!feedCache.get("profile:posts")?.posts?.length) {
    try {
      const { data } = await supabase
        .from("posts")
        .select("*, post_media(*), post_tags(tag)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data?.length) {
        const posts = data.map((p: any) => ({
          id: p.id,
          user_id: p.user_id,
          category: p.category,
          comment: p.comment,
          location: { latitude: p.latitude ?? 0, longitude: p.longitude ?? 0 },
          address: p.address,
          is_anonymous: p.is_anonymous,
          status: p.status,
          is_sensitive: p.is_sensitive,
          confirmations: p.confirmations || 0,
          views: p.views || 0,
          comment_count: p.comment_count || 0,
          report_count: p.report_count || 0,
          created_at: p.created_at,
          media: (p.post_media || []).map((m: any) => ({
            id: m.id,
            post_id: p.id,
            url: m.url,
            media_type: m.media_type,
            is_sensitive: m.is_sensitive,
          })),
          tags: (p.post_tags || []).map((t: any) => t.tag),
        }));
        feedCache.setPosts("profile:posts", posts);
      }
    } catch {}
  }

  // Notifications (only if not already cached)
  if (!feedCache.get("notifications:list")?.posts?.length) {
    try {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (data?.length) {
        // Store notifications as "posts" in feedCache (feedCache is generic)
        feedCache.setPosts("notifications:list", data as any);
      }
    } catch {}
  }
}
