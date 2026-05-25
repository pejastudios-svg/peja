"use client";

// Hydrates the local cache of emergency contacts (lib/emergencyContactsCache)
// whenever a signed-in user is online. The offline SOS / SML flows
// read this cache to know who to message or who to share location
// with — without it, going offline with a stale or empty cache
// leaves them with nothing to do.
//
// Lives at the root layout so it runs on every page. Previously the
// same effect lived inside SOSButton, which only mounts inside the
// BottomNav allowlist (home + search), so opening the app on /map
// or /messages never populated the cache. Lifting it global fixes
// that.
//
// Renders nothing — same shape as ChatBootstrap / OutboxBootstrap.

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  writeEmergencyContactsCache,
  type CachedEmergencyContact,
} from "@/lib/emergencyContactsCache";

export function EmergencyContactsBootstrap() {
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from("emergency_contacts")
          .select("id, name, phone, contact_user_id, status")
          .eq("user_id", userId);
        if (cancelled || error || !data) return;

        // Best-effort join to users for full_name + avatar_url so
        // SML's share sheet can render rows without a second hop.
        const linkedIds = data
          .map((c: any) => c.contact_user_id)
          .filter((id: unknown): id is string => typeof id === "string");
        const userMap: Record<string, { full_name: string | null; avatar_url: string | null }> = {};
        if (linkedIds.length > 0) {
          const { data: users } = await supabase
            .from("users")
            .select("id, full_name, avatar_url")
            .in("id", linkedIds);
          for (const u of users || []) {
            userMap[(u as any).id] = {
              full_name: (u as any).full_name ?? null,
              avatar_url: (u as any).avatar_url ?? null,
            };
          }
        }

        const contacts: CachedEmergencyContact[] = data.map((c: any) => {
          const linked = c.contact_user_id ? userMap[c.contact_user_id] : null;
          return {
            id: c.id,
            name: c.name ?? "",
            phone: typeof c.phone === "string" ? c.phone : "",
            contact_user_id: c.contact_user_id ?? null,
            status: (c.status ?? null) as CachedEmergencyContact["status"],
            linked_full_name: linked?.full_name ?? null,
            linked_avatar_url: linked?.avatar_url ?? null,
          };
        });
        writeEmergencyContactsCache(userId, contacts);
      } catch {
        // Best-effort — silent on failure. The offline flows handle
        // an empty cache with a user-facing toast.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return null;
}
