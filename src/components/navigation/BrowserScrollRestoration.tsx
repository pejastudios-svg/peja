"use client";

import { useEffect } from "react";

export default function BrowserScrollRestoration() {
  useEffect(() => {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "auto";
    }
  }, []);

  return null;
}