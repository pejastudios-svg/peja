"use client";

import { useEffect, useState } from "react";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    // Start animation on next frame — content is already visible
    requestAnimationFrame(() => {
      setAnimateIn(true);
    });
  }, []);

  return (
    <div
      data-chat-layout
      className={`fixed inset-0 z-50 bg-[#0a0812] transition-transform duration-250 ease-out ${
        animateIn ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {children}
    </div>
  );
}