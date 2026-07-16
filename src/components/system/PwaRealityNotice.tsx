"use client";

import { useEffect, useState } from "react";
import { Bell, Eye, MapPin } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";
import { isCapacitor } from "@/lib/ambientTracker";

// One-time honesty notice for Home Screen web app users (mostly iPhone):
// live location only updates while peja is open on screen; pushes still
// arrive when it's closed. Setting expectations up front beats a user
// discovering it during an emergency.

const SEEN_KEY = "peja-pwa-reality-seen";

function isStandalone(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    return Boolean((navigator as unknown as { standalone?: boolean }).standalone);
  } catch {
    return false;
  }
}

export function PwaRealityNotice() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (isCapacitor() || !isStandalone()) return;
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
    } catch {}
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [user]);

  const close = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
    setOpen(false);
  };

  if (!open) return null;

  return (
    <Modal isOpen={open} onClose={close} title="How location works here">
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-2xl bg-dark-800/60 border border-dark-700 p-3">
            <div className="w-9 h-9 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
              <Eye className="w-4.5 h-4.5 text-green-500" />
            </div>
            <p className="text-sm text-dark-100 leading-relaxed">
              <span className="font-semibold">While peja is open</span> on your
              screen, everything is live: your location, check-ins, and SOS.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-2xl bg-dark-800/60 border border-dark-700 p-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
              <MapPin className="w-4.5 h-4.5 text-amber-500" />
            </div>
            <p className="text-sm text-dark-100 leading-relaxed">
              <span className="font-semibold">When you leave or lock</span> your
              phone, location updates pause. Your circle sees your last known
              spot, honestly labeled with how old it is.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-2xl bg-dark-800/60 border border-dark-700 p-3">
            <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
              <Bell className="beacon-accent-text w-4.5 h-4.5" />
            </div>
            <p className="text-sm text-dark-100 leading-relaxed">
              <span className="font-semibold">Alerts always reach you.</span>{" "}
              SOS, check-ins, and pings arrive as notifications even when peja
              is closed.
            </p>
          </div>
        </div>
        <p className="text-xs text-dark-500 leading-relaxed">
          Tip: during a check-in or any moment that matters, keep peja open on
          screen so your people see you live.
        </p>
        <button
          onClick={close}
          className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.98] transition-transform"
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}
