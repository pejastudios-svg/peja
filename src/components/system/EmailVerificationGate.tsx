"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

// One place that keeps unconfirmed accounts out of the app. Mounted in
// the root layout so every route inherits it and no screen can be reached
// by deep link before the address is confirmed.
//
// Honest limitation: this is a CLIENT gate. The account already holds a
// session (peja does its own verification rather than Supabase's built-in
// confirmation), so it stops ordinary use, not someone deliberately
// calling the API. Anything that must be airtight should check
// users.email_verified server side.

// Places an unconfirmed user is still allowed to be.
const ALLOWED = [
  "/verify-email",
  "/login",
  "/signup",
  "/forgot-password",
  "/welcome",
  "/about",
  "/terms",
  "/privacy",
  "/help",
  "/join",
  "/beacon-invite",
];

// A Beacon invite opened before the account existed parks its token in
// localStorage (see beacon-invite/[token]). Once the user is signed in and
// verified, send them back to finish the claim. Lives here because this
// component is mounted globally and already watches exactly the right
// transition (user arrives + verified).
const PENDING_INVITE_KEY = "peja-pending-beacon-invite";

export function EmailVerificationGate() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !user) return;
    if (user.email_verified) {
      // Replay a parked Beacon invite now that the account is usable.
      try {
        const token = localStorage.getItem(PENDING_INVITE_KEY);
        if (token && !pathname.startsWith("/beacon-invite")) {
          router.replace(`/beacon-invite/${token}`);
        }
      } catch {}
      return;
    }
    if (ALLOWED.some((p) => pathname.startsWith(p))) return;
    router.replace("/verify-email");
  }, [user, loading, pathname, router]);

  return null;
}
