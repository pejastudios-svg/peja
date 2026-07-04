"use client";

// Mounts the generic offline-outbox drain (lib/useOutboxDrain) at the
// root of the app so queued SOS / SML / post actions replay as soon
// as the user has network, regardless of which page they're on.
//
// Renders nothing. Pattern mirrors ChatBootstrap — a hook needs to
// run inside a client boundary at the layout level, and a tiny
// dedicated component is the cleanest way to do that.

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOutboxDrain } from "@/lib/useOutboxDrain";
import { useToast } from "@/context/ToastContext";

export function OutboxBootstrap() {
  const { user } = useAuth();
  const toast = useToast();
  useOutboxDrain(user?.id ?? null);

  // Surface a queued action that could never sync (e.g. an SOS log or
  // check-in that failed every retry) instead of stranding it silently.
  useEffect(() => {
    const onStranded = (e: Event) => {
      const kind = ((e as CustomEvent).detail?.kind as string | undefined) || "";
      const label = kind.startsWith("sos")
        ? "An SOS couldn't finish syncing."
        : kind.startsWith("sml")
        ? "A check-in couldn't finish syncing."
        : kind.startsWith("post")
        ? "A post couldn't finish syncing."
        : "A queued action couldn't finish syncing.";
      toast.warning(`${label} Please check your connection and try again.`);
    };
    window.addEventListener("peja-outbox-stranded", onStranded);
    return () => window.removeEventListener("peja-outbox-stranded", onStranded);
  }, [toast]);

  return null;
}
