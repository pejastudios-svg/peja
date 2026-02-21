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
            // adjustResize in AndroidManifest already handles the resize
            // We only need to track that keyboard is open, not apply offset
            document.documentElement.style.setProperty("--keyboard-height", "0px");
            document.body.classList.add("keyboard-open");
            
            // Store raw value in case some specific component needs it
            document.documentElement.style.setProperty(
              "--keyboard-height-raw",
              `${info.keyboardHeight}px`
            );
          }
        );

        const hideListener = await CapKeyboard.addListener(
          "keyboardWillHide",
          () => {
            document.documentElement.style.setProperty("--keyboard-height", "0px");
            document.documentElement.style.setProperty("--keyboard-height-raw", "0px");
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

        if (keyboardHeight > 100) {
          // Keyboard is open
          document.body.classList.add("keyboard-open");
          document.documentElement.style.setProperty("--keyboard-height", "0px");
          document.documentElement.style.setProperty(
            "--keyboard-height-raw",
            `${keyboardHeight}px`
          );
        } else {
          document.documentElement.style.setProperty("--keyboard-height", "0px");
          document.documentElement.style.setProperty("--keyboard-height-raw", "0px");
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
      document.documentElement.style.setProperty("--keyboard-height-raw", "0px");
      document.body.classList.remove("keyboard-open");
    };
  }, []);

  return null;
}