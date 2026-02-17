"use client";

import { useEffect } from "react";

export function CapacitorKeyboardHandler() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cleanup: (() => void) | null = null;

    const init = async () => {
      const isCapacitor =
        typeof window !== "undefined" &&
        (window as any).Capacitor?.isNativePlatform?.();

      if (!isCapacitor) {
        setupVisualViewportHandler();
        return;
      }

      try {
        const { Keyboard: CapKeyboard } = await import("@capacitor/keyboard");

        const showListener = await CapKeyboard.addListener(
          "keyboardWillShow",
          (info: { keyboardHeight: number }) => {
            const rawHeight = info.keyboardHeight || 0;
            
            // DEBUG: Show the raw keyboard height
            console.log("[KEYBOARD DEBUG] Raw height from Capacitor:", rawHeight);
            
            // Use percentage-based reduction instead of fixed pixels
            // Take only 60% of the reported height
            const adjustedHeight = Math.round(rawHeight * 0.55);
            
            console.log("[KEYBOARD DEBUG] Adjusted height (55%):", adjustedHeight);
            
            document.documentElement.style.setProperty(
              "--keyboard-height",
              `${adjustedHeight}px`
            );
            document.body.classList.add("keyboard-open");
            
            // DEBUG: Show a toast with the values (remove after testing)
            showDebugToast(`Raw: ${rawHeight}px | Used: ${adjustedHeight}px`);
          }
        );

        const hideListener = await CapKeyboard.addListener(
          "keyboardWillHide",
          () => {
            console.log("[KEYBOARD DEBUG] Keyboard hidden");
            document.documentElement.style.setProperty("--keyboard-height", "0px");
            document.body.classList.remove("keyboard-open");
            hideDebugToast();
          }
        );

        cleanup = () => {
          showListener.remove();
          hideListener.remove();
        };
      } catch (e) {
        console.warn("Capacitor Keyboard plugin not available, using fallback");
        setupVisualViewportHandler();
      }
    };

    const setupVisualViewportHandler = () => {
      const vv = window.visualViewport;
      if (!vv) return;

      const onResize = () => {
        const currentHeight = vv.height;
        const windowHeight = window.innerHeight;
        const keyboardHeight = windowHeight - currentHeight;

        if (keyboardHeight > 100) {
          const adjustedHeight = Math.round(keyboardHeight * 0.55);
          
          console.log("[KEYBOARD DEBUG] VisualViewport - Raw:", keyboardHeight, "Adjusted:", adjustedHeight);
          
          document.documentElement.style.setProperty(
            "--keyboard-height",
            `${adjustedHeight}px`
          );
          document.body.classList.add("keyboard-open");
          
          showDebugToast(`Raw: ${keyboardHeight}px | Used: ${adjustedHeight}px`);
        } else {
          document.documentElement.style.setProperty("--keyboard-height", "0px");
          document.body.classList.remove("keyboard-open");
          hideDebugToast();
        }
      };

      vv.addEventListener("resize", onResize);

      cleanup = () => {
        vv.removeEventListener("resize", onResize);
      };
    };

    // Debug toast helpers
    const showDebugToast = (msg: string) => {
      let toast = document.getElementById("keyboard-debug-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "keyboard-debug-toast";
        toast.style.cssText = `
          position: fixed;
          top: 80px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.9);
          color: #00ff00;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 12px;
          font-family: monospace;
          z-index: 999999;
          pointer-events: none;
        `;
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.display = "block";
    };

    const hideDebugToast = () => {
      const toast = document.getElementById("keyboard-debug-toast");
      if (toast) toast.style.display = "none";
    };

    init();

    return () => {
      if (cleanup) cleanup();
      document.documentElement.style.setProperty("--keyboard-height", "0px");
      document.body.classList.remove("keyboard-open");
      hideDebugToast();
    };
  }, []);

  return null;
}