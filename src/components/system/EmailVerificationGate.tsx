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
];

export function EmailVerificationGate() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !user) return;
    if (user.email_verified) return;
    if (ALLOWED.some((p) => pathname.startsWith(p))) return;
    router.replace("/verify-email");
  }, [user, loading, pathname, router]);

  return null;
}
