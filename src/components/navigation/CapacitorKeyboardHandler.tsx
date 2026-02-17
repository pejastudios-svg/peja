"use client";

import { useEffect } from "react";

export function CapacitorKeyboardHandler() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let Keyboard: any = null;
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
        Keyboard = CapKeyboard;

        // Listen to keyboard show
        const showListener = await Keyboard.addListener(
          "keyboardWillShow",
          (info: { keyboardHeight: number }) => {
            const height = info.keyboardHeight || 0;
            document.documentElement.style.setProperty(
              "--keyboard-height",
              `${height}px`
            );
            document.body.classList.add("keyboard-open");

            // Scroll active element into view
            setTimeout(() => {
              const active = document.activeElement as HTMLElement;
              if (
                active &&
                (active.tagName === "INPUT" ||
                  active.tagName === "TEXTAREA" ||
                  active.isContentEditable)
              ) {
                active.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              }
            }, 100);
          }
        );

        // Listen to keyboard hide
        const hideListener = await Keyboard.addListener(
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

      let initialHeight = vv.height;

      const onResize = () => {
        const currentHeight = vv.height;
        const keyboardHeight = window.innerHeight - currentHeight;

        if (keyboardHeight > 50) {
          document.documentElement.style.setProperty(
            "--keyboard-height",
            `${keyboardHeight}px`
          );
          document.body.classList.add("keyboard-open");

          // Scroll active element into view
          setTimeout(() => {
            const active = document.activeElement as HTMLElement;
            if (
              active &&
              (active.tagName === "INPUT" ||
                active.tagName === "TEXTAREA" ||
                active.isContentEditable)
            ) {
              active.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }
          }, 100);
        } else {
          document.documentElement.style.setProperty("--keyboard-height", "0px");
          document.body.classList.remove("keyboard-open");
        }

        initialHeight = currentHeight;
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