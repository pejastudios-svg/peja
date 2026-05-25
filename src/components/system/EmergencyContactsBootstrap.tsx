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

    let cancelled = false;

    async function populate() {
      // Skip when the browser is sure we're offline — the supabase
      // query would just hang. We retry on the 'online' event below.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        console.log("[contacts-cache] skip populate: offline");
        return;
      }
      try {
        console.log("[contacts-cache] fetching for user", userId);
        const { data, error } = await supabase
          .from("emergency_contacts")
          .select("id, name, phone, contact_user_id, status")
          .eq("user_id", userId);
        if (cancelled) return;
        if (error) {
          console.warn("[contacts-cache] query failed", error.message);
          return;
        }
        if (!data) {
          console.warn("[contacts-cache] query returned null data");
          return;
        }
        console.log(
          "[contacts-cache] got",
          data.length,
          "rows from emergency_contacts",
          data,
        );

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
        writeEmergencyContactsCache(userId!, contacts);
        console.log(
          "[contacts-cache] wrote",
          contacts.length,
          "contacts to cache",
          contacts,
        );
      } catch (e) {
        console.warn("[contacts-cache] populate threw", e);
      }
    }

    void populate();

    // Re-populate when the network comes back — handles the
    // offline-first case where the user opens the app with no
    // signal and then reconnects.
    const onOnline = () => {
      console.log("[contacts-cache] online event, re-populating");
      void populate();
    };
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [userId]);

  return null;
}
