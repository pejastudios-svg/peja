"use client";

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";

// OAuth providers redirect to the destination URL with a #access_token=...
// fragment. Without intervention, the previous history entry is the Supabase
// /auth/v1/callback URL (and behind that, Google's account chooser) —
// pressing back from the destination silently bounces the user back into the
// OAuth flow.
//
// Login/Signup OAuth handlers set a sessionStorage flag right before kicking
// off the redirect. Once the user is authed on the destination page, we
// consume the flag and perform pure history surgery:
//   1. Replace the current entry's URL with "/" (turns this slot into home).
//   2. Push the destination path back on top — same path, no navigation, no
//      React re-render, no modal interceptor.
//
// Net history: [..., /, /post/abc]. One back press lands on home.
//
// We don't gate on `window.location.hash` because Supabase JS strips the
// fragment before our effect can run, so the signal would be gone.
const KEY = "peja-oauth-pending";

export function PostAuthRedirect() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(KEY) !== "1") return;

    sessionStorage.removeItem(KEY);

    const path = window.location.pathname + window.location.search;
    if (path === "/") return; // already on home, nothing to do

    try {
      window.history.replaceState(null, "", "/");
      window.history.pushState(null, "", path);
    } catch {}
  }, [user, loading]);

  return null;
}
