"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { playNotificationSound } from "@/lib/notificationSound";
import { X, Bell, AlertTriangle, MapPin, MessageCircle, CheckCircle, Heart } from "lucide-react";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: any;
  is_read: boolean;
  created_at: string;
};

function iconFor(type: string) {
  switch (type) {
    case "sos_alert":
      return <AlertTriangle className="w-5 h-5 text-red-400" />;
    case "nearby_incident":
      return <MapPin className="w-5 h-5 text-orange-400" />;
    case "post_comment":
      return <MessageCircle className="w-5 h-5 text-blue-400" />;
    case "post_confirmed":
      return <CheckCircle className="w-5 h-5 text-green-400" />;
    case "comment_liked":
      return <Heart className="w-5 h-5 text-red-400" />;
    default:
      return <Bell className="w-5 h-5 text-primary-400" />;
          case "comment_reply":
      return <MessageCircle className="w-5 h-5 text-blue-400" />;
  }
}

function routeFor(n: NotificationRow): string | null {
  const data = n.data || {};

  switch (n.type) {
    case "sos_alert":
      return data.sos_id ? `/map?sos=${encodeURIComponent(data.sos_id)}` : "/map";

    case "nearby_incident":
    case "post_confirmed":
    case "post_comment":
    case "comment_reply":
    case "comment_liked":
      return data.post_id ? `/post/${encodeURIComponent(data.post_id)}` : null;

    case "guardian_approved":
    case "guardian_rejected":
      return "/become-guardian";

    default:
      return data.post_id ? `/post/${encodeURIComponent(data.post_id)}` : "/notifications";
  }
}

export default function InAppNotificationToasts() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [toasts, setToasts] = useState<NotificationRow[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const shouldHide = useMemo(() => {
    // Don’t show on full-screen watch
    if (pathname === "/watch") return true;
    return false;
  }, [pathname]);

  useEffect(() => {
    if (!user?.id) return;
    if (shouldHide) return;

    const channel = supabase
      .channel("inapp-toasts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as NotificationRow;

          // Avoid duplicates (sometimes realtime can re-fire during reconnect)
          if (seenIdsRef.current.has(n.id)) return;
          seenIdsRef.current.add(n.id);

          // Sound
          playNotificationSound();

          // Push toast (max 3)
          setToasts((prev) => {
            const next = [n, ...prev].slice(0, 3);
            return next;
          });

          // Let header refresh count (you already listen for this event)
          window.dispatchEvent(new Event("peja-notifications-changed"));

          // Auto-dismiss after 6s
          window.setTimeout(() => {
            setToasts((prev) => prev.filter((x) => x.id !== n.id));
          }, 6000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, shouldHide]);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id));

  const markRead = async (id: string) => {
    try {
      await supabase.from("notifications").update({ is_read: true }).eq("id", id);
      window.dispatchEvent(new Event("peja-notifications-changed"));
    } catch {}
  };

  if (!user?.id || shouldHide) return null;
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed left-0 right-0 z-[12000] flex justify-center px-3"
      style={{
        top: "calc(64px + env(safe-area-inset-top, 0px) + 8px)",
      }}
    >
      <div className="w-full max-w-md space-y-2">
        {toasts.map((n) => (
          <div
            key={n.id}
            className="glass-float rounded-2xl border border-white/10 shadow-xl overflow-hidden animate-[toastIn_180ms_ease-out]"
            onClick={async () => {
              await markRead(n.id);
              dismiss(n.id);

              const to = routeFor(n);
              if (to) router.push(to, { scroll: false });
            }}
            role="button"
            tabIndex={0}
          >
            <div className="p-3 flex items-start gap-3">
              <div className="p-2 rounded-xl bg-dark-800/60 shrink-0">{iconFor(n.type)}</div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-dark-100 truncate">{n.title}</p>
                {n.body && <p className="text-xs text-dark-300 mt-0.5 line-clamp-2">{n.body}</p>
                }
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dismiss(n.id);
                }}
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
  );
}