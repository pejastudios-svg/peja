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

        // Android `adjustResize` shrinks the WebView while the keyboard is
        // open. If the app is backgrounded mid-keyboard (notification panel,
        // app switch, recents view), the OS sometimes fails to restore the
        // WebView's bounds when the app comes back — you return to a
        // shrunk WebView with the BottomNav floating mid-screen and a black
        // band underneath where the keyboard used to sit.
        //
        // Force `Keyboard.hide()` on every resume to clear any stuck IME
        // state, and dispatch a window `resize` so any JS that derives
        // layout from `window.innerHeight` / `visualViewport` recomputes.
        let appResumeListener: { remove: () => void } | null = null;
        try {
          const { App } = await import("@capacitor/app");
          const handle = await App.addListener("appStateChange", async ({ isActive }) => {
            if (!isActive) return;
            try { await CapKeyboard.hide(); } catch {}
            document.body.classList.remove("keyboard-open");
            document.documentElement.style.setProperty("--keyboard-height", "0px");
            document.documentElement.style.setProperty("--keyboard-height-raw", "0px");
            // Defer the resize tick — gives the OS one frame to restore
            // WebView bounds before listeners read window.innerHeight.
            window.requestAnimationFrame(() => {
              window.dispatchEvent(new Event("resize"));
            });
          });
          appResumeListener = handle;
        } catch {}

        cleanup = () => {
          showListener.remove();
          hideListener.remove();
          appResumeListener?.remove();
        };
      } catch (e) {
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