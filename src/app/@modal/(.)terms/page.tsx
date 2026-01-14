"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TermsPage from "@/app/terms/page";

export default function TermsModal() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(t);
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          mounted ? "opacity-100" : "opacity-0"
        }`}
        onClick={() => router.back()}
      />
      <div
        className={`absolute inset-0 overflow-y-auto overscroll-contain bg-dark-950 transition-transform duration-200 ${
          mounted ? "translate-y-0" : "translate-y-6"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <TermsPage />
      </div>
    </div>
  );
}