"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { X, AlertTriangle, CheckCircle2, Info } from "lucide-react";

type ToastType = "info" | "success" | "warning" | "danger";

type Toast = {
  id: string;
  type: ToastType;
  message: string;
  ttlMs?: number;
};

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
  if (type === "success") return <CheckCircle2 className="w-5 h-5 text-green-400" />;
  if (type === "warning") return <AlertTriangle className="w-5 h-5 text-orange-400" />;
  if (type === "danger") return <AlertTriangle className="w-5 h-5 text-red-400" />;
  return <Info className="w-5 h-5 text-primary-400" />;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = (t: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    const toast: Toast = { id, ttlMs: 3500, ...t };

    setToasts((prev) => [toast, ...prev].slice(0, 4));

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, toast.ttlMs || 3500);
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

      {/* Toast host */}
      <div
        className="fixed left-0 right-0 z-[200000] flex justify-center px-3"
        style={{ top: "calc(64px + env(safe-area-inset-top, 0px) + 8px)" }}
      >
        <div className="w-full max-w-md space-y-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="glass-float rounded-2xl border border-white/10 shadow-xl overflow-hidden animate-[toastIn_180ms_ease-out]"
            >
              <div className="p-3 flex items-start gap-3">
                <div className="p-2 rounded-xl bg-dark-800/60 shrink-0">{iconFor(t.type)}</div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-dark-100">{t.message}</p>
                </div>

                <button
                  type="button"
                  onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                  className="p-2 rounded-lg hover:bg-white/10 text-dark-400"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
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