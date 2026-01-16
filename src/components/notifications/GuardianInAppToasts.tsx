"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { playNotificationSound } from "@/lib/notificationSound";
import { useRouter, usePathname } from "next/navigation";
import { X, Bell } from "lucide-react";

type Row = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: any;
  is_read: boolean;
  created_at: string;
  recipient_id: string;
};

export default function GuardianInAppToasts() {
  const router = useRouter();
  const pathname = usePathname();
  const [toasts, setToasts] = useState<Row[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!pathname.startsWith("/guardian")) return;

    let channel: any;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;

      channel = supabase
        .channel("guardian-inapp-toasts")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "guardian_notifications", filter: `recipient_id=eq.${uid}` },
          (payload) => {
            const n = payload.new as Row;
            if (seen.current.has(n.id)) return;
            seen.current.add(n.id);

            playNotificationSound();
            setToasts((prev) => [n, ...prev].slice(0, 3));

            window.setTimeout(() => {
              setToasts((prev) => prev.filter((x) => x.id !== n.id));
            }, 6500);
          }
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [pathname]);

  const go = async (n: Row) => {
    try {
      await supabase.from("guardian_notifications").update({ is_read: true }).eq("id", n.id);
    } catch {}

    if (n.type === "flagged_post") {
      router.push(`/guardian/queue?review=${encodeURIComponent(n.data?.flagged_id || "")}`);
      return;
    }
    router.push("/guardian/notifications");
  };

  if (!pathname.startsWith("/guardian")) return null;
  if (toasts.length === 0) return null;

  return (
    <div className="fixed left-0 right-0 z-[35000] flex justify-center px-3" style={{ top: "calc(64px + env(safe-area-inset-top, 0px) + 8px)" }}>
      <div className="w-full max-w-md space-y-2">
        {toasts.map((n) => (
          <div
            key={n.id}
            className="glass-float rounded-2xl border border-white/10 shadow-xl overflow-hidden animate-[toastIn_180ms_ease-out]"
            onClick={() => go(n)}
          >
            <div className="p-3 flex items-start gap-3">
              <div className="p-2 rounded-xl bg-dark-800/60 shrink-0">
                <Bell className="w-5 h-5 text-primary-400" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-dark-100 truncate">{n.title}</p>
                {n.body && <p className="text-xs text-dark-300 mt-0.5 line-clamp-2">{n.body}</p>}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setToasts((prev) => prev.filter((x) => x.id !== n.id));
                }}
                className="p-2 rounded-lg hover:bg-white/10 text-dark-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}