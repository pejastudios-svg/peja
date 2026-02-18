"use client";

import { useEffect, useState, useRef } from "react";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Wait a frame for children to render their initial state
    timeoutRef.current = setTimeout(() => {
      setReady(true);
      // Then animate in
      requestAnimationFrame(() => {
        setAnimateIn(true);
      });
    }, 50); // Small delay to let content mount

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      data-chat-layout
      className={`fixed inset-0 z-50 bg-[#0a0812] transition-transform duration-300 ease-out ${
        ready
          ? animateIn
            ? "translate-x-0"
            : "translate-x-full"
          : "translate-x-full"
      }`}
      style={{
        visibility: ready ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
}