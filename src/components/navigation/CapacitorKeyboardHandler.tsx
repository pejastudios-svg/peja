"use client";

import { useEffect } from "react";

export function CapacitorKeyboardHandler() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cleanup: (() => void) | null = null;

    const init = async () => {
      // Only run in Capacitor
      const isCapacitor =
        typeof window !== "undefined" &&
        (window as any).Capacitor?.isNativePlatform?.();

      if (!isCapacitor) {
        // Fallback: Use visualViewport for web/PWA
        setupVisualViewportHandler();
        return;
      }

      try {
        const { Keyboard: CapKeyboard } = await import("@capacitor/keyboard");

        // Listen to keyboard show
        const showListener = await CapKeyboard.addListener(
          "keyboardWillShow",
          (info: { keyboardHeight: number }) => {
            // Subtract gesture nav bar height (typically 48-60px on Android)
            // This prevents the input from being pushed too high
            const rawHeight = info.keyboardHeight || 0;
            const adjustedHeight = Math.max(0, rawHeight - 72);
            
            document.documentElement.style.setProperty(
              "--keyboard-height",
              `${adjustedHeight}px`
            );
            document.body.classList.add("keyboard-open");
          }
        );

        // Listen to keyboard hide
        const hideListener = await CapKeyboard.addListener(
          "keyboardWillHide",
          () => {
            document.documentElement.style.setProperty("--keyboard-height", "0px");
            document.body.classList.remove("keyboard-open");
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

        // Only apply if significant keyboard height detected
        // Subtract 48px to account for gesture nav bar
        if (keyboardHeight > 100) {
          const adjustedHeight = Math.max(0, keyboardHeight - 48);
          document.documentElement.style.setProperty(
            "--keyboard-height",
            `${adjustedHeight}px`
          );
          document.body.classList.add("keyboard-open");
        } else {
          document.documentElement.style.setProperty("--keyboard-height", "0px");
          document.body.classList.remove("keyboard-open");
        }
      };

      vv.addEventListener("resize", onResize);

      cleanup = () => {
        vv.removeEventListener("resize", onResize);
      };
    };

    init();

    return () => {
      if (cleanup) cleanup();
      document.documentElement.style.setProperty("--keyboard-height", "0px");
      document.body.classList.remove("keyboard-open");
    };
  }, []);

  return null;
}