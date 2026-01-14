"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PostDetailPage from "@/app/post/[id]/page";

export default function PostModalRoute() {
  const router = useRouter();

  const zIndex =
    typeof window !== "undefined" && (window as any).__pejaWatchOpen ? 12000 : 10000;

  const [mounted, setMounted] = useState(false);
  const closingRef = useRef(false);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;

    // animate out
    setMounted(false);

    // after animation, actually go back
    window.setTimeout(() => {
      router.back();
    }, 180);
  };

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));

    // mark "post modal open" globally (so PostDetail back button can animate-close)
    (window as any).__pejaPostModalOpen = true;

    // lock background scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // pause pages underneath (watch + inline videos)
    window.dispatchEvent(new Event("peja-modal-open"));

    // allow PostDetail to close the modal with animation by dispatching an event
    const onCloseEvent = () => close();
    window.addEventListener("peja-close-post", onCloseEvent);

    return () => {
      cancelAnimationFrame(t);

      (window as any).__pejaPostModalOpen = false;

      document.body.style.overflow = prev;

      // resume pages underneath
      window.dispatchEvent(new Event("peja-modal-close"));

      window.removeEventListener("peja-close-post", onCloseEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0" style={{ zIndex }}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          mounted ? "opacity-100" : "opacity-0"
        }`}
        onClick={close}
      />

      {/* Sheet (NO transform => fixed bottom bars behave correctly) */}
      <div
        className={`absolute left-0 right-0 bottom-0 bg-dark-950 overscroll-contain transition-[top,opacity] duration-200 ${
          mounted ? "opacity-100" : "opacity-0"
        } overflow-y-auto`}
        style={{
          top: mounted ? "0px" : "24px",
          paddingTop: "env(safe-area-inset-top)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <PostDetailPage />
      </div>
    </div>
  );
}