"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

type ToastType = "info" | "success" | "warning" | "danger";

type Toast = {
  id: string;
  type: ToastType;
  message: string;
  ttlMs?: number;
  /** Exit in progress: pill is playing its slide-up-and-fade animation. */
  leaving?: boolean;
};

/** Keep in sync with the toastOut animation duration in globals.css. */
const EXIT_MS = 220;

type ToastApi = {
  show: (t: Omit<Toast, "id">) => void;
  info: (message: string, ttlMs?: number) => void;
  success: (message: string, ttlMs?: number) => void;
  warning: (message: string, ttlMs?: number) => void;
  danger: (message: string, ttlMs?: number) => void;
};

const Ctx = createContext<ToastApi | null>(null);

const FLASH_KEY = "peja-flash-toast-v1";

export function setFlashToast(type: ToastType, message: string, ttlMs = 3500) {
  try {
    sessionStorage.setItem(FLASH_KEY, JSON.stringify({ type, message, ttlMs }));
  } catch {}
}

function consumeFlashToast(): { type: ToastType; message: string; ttlMs?: number } | null {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(FLASH_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function iconFor(type: ToastType) {
  // Slim icons so the toast reads as a chip, not a banner.
  if (type === "success") return <CheckCircle2 className="w-4 h-4 text-green-400" />;
  if (type === "warning") return <AlertTriangle className="w-4 h-4 text-orange-400" />;
  if (type === "danger") return <AlertTriangle className="w-4 h-4 text-red-400" />;
  return <Info className="w-4 h-4 text-primary-400" />;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Swipe tracking per toast id (touch start Y), for swipe-up-to-dismiss.
  const touchStartY = useRef<Record<string, number>>({});

  // Every exit path (tap, swipe up, X, timeout) goes through here so the
  // pill always slides up and fades (WhatsApp-style) instead of popping out.
  const dismiss = (id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id && !t.leaving ? { ...t, leaving: true } : t))
    );
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, EXIT_MS);
  };

  const show = (t: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    const toast: Toast = { id, ttlMs: 3500, ...t };

    setToasts((prev) => [toast, ...prev].slice(0, 4));

    window.setTimeout(() => dismiss(id), toast.ttlMs || 3500);
  };

  const api = useMemo<ToastApi>(
    () => ({
      show,
      info: (m, ttlMs) => show({ type: "info", message: m, ttlMs }),
      success: (m, ttlMs) => show({ type: "success", message: m, ttlMs }),
      warning: (m, ttlMs) => show({ type: "warning", message: m, ttlMs }),
      danger: (m, ttlMs) => show({ type: "danger", message: m, ttlMs }),
    }),
    []
  );

  // show flash toast after redirects (ban/suspend/login blocks)
  useEffect(() => {
    const f = consumeFlashToast();
    if (f?.message) show({ type: f.type, message: f.message, ttlMs: f.ttlMs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={api}>
      {children}

      {/* Toast host. These are action-confirmation pills ("Copied",
          "Muted", "Reported", etc.) — kept compact on purpose so they
          read like a status badge rather than a heavy banner.
          Inbound push toasts use a separate component
          (components/notifications/InAppNotificationToasts) which
          retains the larger size. */}
      <div
        className="fixed left-0 right-0 z-[200000] flex justify-center px-3"
        style={{ top: "calc(64px + env(safe-area-inset-top, 0px) + 8px)" }}
      >
        <div className="flex flex-col items-center gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              onTouchStart={(e) => {
                touchStartY.current[t.id] = e.touches[0].clientY;
              }}
              onTouchMove={(e) => {
                const start = touchStartY.current[t.id];
                if (start != null && start - e.touches[0].clientY > 24) {
                  delete touchStartY.current[t.id];
                  dismiss(t.id);
                }
              }}
              className={`inline-flex max-w-[90vw] glass-float rounded-full border border-white/10 shadow-xl overflow-hidden cursor-pointer select-none ${
                t.leaving
                  ? "animate-[toastOut_220ms_cubic-bezier(0.32,0.72,0,1)_forwards]"
                  : "animate-[toastIn_180ms_ease-out]"
              }`}
            >
              <div className="px-3 py-1.5 flex items-center gap-2">
                <span className="shrink-0 flex items-center justify-center">
                  {iconFor(t.type)}
                </span>

                <p className="text-[13px] font-medium text-dark-100 leading-snug break-words">
                  {t.message}
                </p>

              </div>
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}