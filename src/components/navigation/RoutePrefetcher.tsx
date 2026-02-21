"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RoutePrefetcher() {
  const router = useRouter();

  useEffect(() => {
    // core tabs
    router.prefetch("/");
    router.prefetch("/map");
    router.prefetch("/create");
    router.prefetch("/profile");
    router.prefetch("/search");
    router.prefetch("/notifications");

    // common sheets/settings
    router.prefetch("/settings");
    router.prefetch("/emergency-contacts");
    router.prefetch("/become-guardian");
    router.prefetch("/help");
    router.prefetch("/privacy");
    router.prefetch("/terms");
  }, [router]);

  return null;
}