"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

export default function HistorySyncGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const appUrl = useMemo(() => {
    const qs = sp?.toString() || "";
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, sp]);

  const appUrlRef = useRef(appUrl);
  const syncingRef = useRef(false);

  // keep current app url in a ref (so popstate handler always sees latest)
  useEffect(() => {
    appUrlRef.current = appUrl;
  }, [appUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onPopState = () => {
      const winUrl = window.location.pathname + window.location.search;

      // Let Next handle it first; we only intervene if it stays mismatched.
      window.setTimeout(() => {
        if (syncingRef.current) return;

        const currentAppUrl = appUrlRef.current;
        if (currentAppUrl === winUrl) return;

        syncingRef.current = true;

        // Force Next router to reconcile to the URL
        try {
          router.replace(winUrl, { scroll: false });
          router.refresh();
        } catch {
          // ignore
        }

        // If still mismatched shortly after, hard reload to match URL
        window.setTimeout(() => {
          const stillMismatch = appUrlRef.current !== winUrl;
          if (stillMismatch) {
            window.location.reload();
          } else {
            syncingRef.current = false;
          }
        }, 450);
      }, 200);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [router]);

  return null;
}