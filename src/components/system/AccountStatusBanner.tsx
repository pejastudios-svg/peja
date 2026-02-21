"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { AlertTriangle, X } from "lucide-react";

export default function AccountStatusBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal when user changes or status changes
  useEffect(() => {
    setDismissed(false);
  }, [user?.id, user?.status]);

  if (!user) return null;
  if (user.status !== "suspended") return null;
  if (dismissed) return null;

  return (
    <div
      className="fixed left-0 right-0 z-[15000] flex justify-center px-3"
      style={{ top: "calc(64px + env(safe-area-inset-top, 0px))" }}
    >
      <div className="w-full max-w-2xl glass-float border border-orange-500/30 rounded-2xl px-4 py-3 flex items-start gap-3 max-w-full">
        <AlertTriangle className="w-5 h-5 text-orange-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-dark-100">Account Suspended</p>
          <p className="text-xs text-dark-300 mt-0.5 break-words">
            You can still receive alerts, but you cannot post, comment, confirm, or use SOS.
            If you believe this is a mistake, contact support.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-2 rounded-lg hover:bg-white/10 text-dark-400"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}