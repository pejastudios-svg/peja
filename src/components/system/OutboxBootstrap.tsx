"use client";

// Mounts the generic offline-outbox drain (lib/useOutboxDrain) at the
// root of the app so queued SOS / SML / post actions replay as soon
// as the user has network, regardless of which page they're on.
//
// Renders nothing. Pattern mirrors ChatBootstrap — a hook needs to
// run inside a client boundary at the layout level, and a tiny
// dedicated component is the cleanest way to do that.

import { useAuth } from "@/context/AuthContext";
import { useOutboxDrain } from "@/lib/useOutboxDrain";

export function OutboxBootstrap() {
  const { user } = useAuth();
  useOutboxDrain(user?.id ?? null);
  return null;
}
