"use client";

import { useLayoutEffect } from "react";

export function BodyScrollUnlocker() {
  useLayoutEffect(() => {
    // Check if body is locked and unlock it
    if (document.body.style.position === "fixed") {
      const scrollY = Math.abs(parseInt(document.body.style.top || "0", 10));
      
      // Remove all lock styles
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.overflow = "";
      document.body.style.width = "";
      
      // Restore scroll position
      window.scrollTo(0, scrollY);
    }
  }); // No dependency array - runs on every render
  
  return null;
}