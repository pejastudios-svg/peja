"use client";

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";

// OAuth providers redirect to the destination URL with a #access_token=...
// fragment. Without intervention, the previous history entry is the OAuth
// hash URL — pressing back from the post bounces the user to that fragment,
// which then re-runs the Google flow / lands on the account picker.
//
// Once the user is authed and Supabase has processed the hash, we:
// 1. Replace the current entry's URL with `/` (sanitizes any leftover hash
//    AND turns this slot into "home" in history).
// 2. Push the actual destination URL back on top — same path, same React
//    tree, no navigation, no modal interceptor.
//
// Net history: [..., /, /post/abc]. Back lands on home in a single press.
export function PostAuthRedirect() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;
    if (!window.location.hash.includes("access_token=")) return;

    const path = window.location.pathname + window.location.search;
    try {
      window.history.replaceState(null, "", "/");
      window.history.pushState(null, "", path);
    } catch {}
  }, [user, loading]);

  return null;
}
