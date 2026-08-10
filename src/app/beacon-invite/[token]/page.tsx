"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Radio, Check } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

// Landing page for a Beacon invite link. Signed out: park the token and
// bounce through login/signup, then claim on return. Signed in: claim
// immediately. The token burns on first successful claim.

const PENDING_KEY = "peja-pending-beacon-invite";

export default function BeaconInvitePage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("");
  const [wearer, setWearer] = useState<string | null>(null);
  const claimedOnce = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    const token = params?.token;
    if (!token) {
      setState("failed");
      setMessage("This invite link is not valid.");
      return;
    }

    if (!user) {
      // Come back here after auth. The login/signup flows return to /,
      // so the claim is finished by the effect below on next visit via
      // the stored token; simplest reliable path is to send them to
      // login with a redirect back to this page.
      try {
        localStorage.setItem(PENDING_KEY, token);
      } catch {}
      router.replace(`/login?next=/beacon-invite/${token}`);
      return;
    }

    if (claimedOnce.current) return;
    claimedOnce.current = true;

    (async () => {
      const { res, data } = await authFetchJson("/api/beacon/invite/claim", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      try {
        localStorage.removeItem(PENDING_KEY);
      } catch {}
      if (!res.ok) {
        setState("failed");
        setMessage(data?.error || "This invite could not be used.");
        return;
      }
      setWearer(data?.wearerName || null);
      setState("done");
    })();
  }, [authLoading, user, params, router]);

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        {state === "working" && (
          <>
            <PejaSpinner className="w-10 h-10 mx-auto mb-4" />
            <p className="text-sm text-dark-400">Opening your invite...</p>
          </>
        )}

        {state === "done" && (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center mb-4">
              <Check className="beacon-ok-text w-7 h-7" />
            </div>
            <h1 className="text-2xl font-black text-dark-50 mb-2">You are in</h1>
            <p className="text-sm text-dark-400 leading-relaxed mb-6">
              {wearer ? `${wearer}'s Beacon` : "The Beacon"} now shows on your
              map whenever it is reporting.
            </p>
            <button
              onClick={() => router.replace("/")}
              className="w-full py-3.5 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.97] transition-transform"
            >
              Open the map
            </button>
          </>
        )}

        {state === "failed" && (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center mb-4">
              <Radio className="beacon-bad-text w-7 h-7" />
            </div>
            <h1 className="text-2xl font-black text-dark-50 mb-2">Invite not available</h1>
            <p className="text-sm text-dark-400 leading-relaxed mb-6">{message}</p>
            <button
              onClick={() => router.replace("/")}
              className="w-full py-3.5 rounded-2xl bg-[var(--soft-surface-strong)] text-dark-100 font-semibold active:scale-[0.97] transition-transform"
            >
              Go home
            </button>
          </>
        )}
      </div>
    </div>
  );
}
