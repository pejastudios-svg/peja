"use client";

import { useRef, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export default function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    // Trigger enter animation on mount
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, []);

  // Handle back navigation with exit animation
  useEffect(() => {
    const handlePopState = () => {
      setIsExiting(true);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <div
  data-chat-layout
  className={`fixed inset-0 z-50 bg-[#0a0812] transition-transform duration-300 ease-out ${
    isVisible && !isExiting
      ? "translate-x-0"
      : isExiting
      ? "translate-x-full"
      : "translate-x-full"
  }`}
  style={{
    willChange: "transform",
  }}
>
  {children}
</div>
  );
}