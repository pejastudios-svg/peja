"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { INVITE_REF_KEY } from "@/lib/invite";

/**
 * Invite landing: peja.life/join?ref=<userId>
 * Logged out: stash the referrer and send them through signup - the home
 * screen (CommunityNudge) claims the invite after their first login.
 * Logged in: stash and go home, where the claim happens immediately.
 */
function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();

  useEffect(() => {
    const ref = params.get("ref");
    if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
      try { localStorage.setItem(INVITE_REF_KEY, ref); } catch {}
    }
    if (loading) return;
    router.replace(user ? "/" : "/signup");
  }, [params, user, loading, router]);

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center">
      <PejaSpinner />
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-dark-950 flex items-center justify-center">
          <PejaSpinner />
        </div>
      }
    >
      <JoinInner />
    </Suspense>
  );
}
