"use client";

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { getSafeNext } from "@/lib/safeNext";

// OAuth providers do a full-page redirect, so we can't script the history
// stack from the login/signup page like we can for form sign-in. Instead, the
// OAuth flow saves the destination here and lands on `/`, and this component
// (mounted at app root) picks it up once the user becomes authed and does a
// full-page navigation. Net history: [/, /post] — back lands on home in one
// press, no leftover hash from the OAuth fragment.
const KEY = "peja-after-auth-redirect";

export function PostAuthRedirect() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;

    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.removeItem(KEY);

    const target = getSafeNext(raw);
    if (!target) return;

    // Make sure the current history entry is a clean `/` (Supabase may not
    // have stripped the #access_token=... fragment yet, and we don't want
    // back from the destination to land on the OAuth-fragment URL — which
    // would silently bounce the user back to Google's account chooser).
    try { window.history.replaceState(null, "", "/"); } catch {}

    // Full-page nav so the (.)post intercepting route doesn't render the
    // destination as a modal on top of the current page.
    window.location.href = target;
  }, [user, loading]);

  return null;
}
