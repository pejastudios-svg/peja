"use client";

import { useEffect, useRef, useState } from "react";
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

function getIcon(type: string) {
  switch (type) {
    case "sos_alert":
      return <AlertTriangle className="w-5 h-5 text-red-400" />;
    case "nearby_incident":
      return <MapPin className="w-5 h-5 text-orange-400" />;
    case "post_comment":
    case "comment_reply":
      return <MessageCircle className="w-5 h-5 text-blue-400" />;
    case "post_confirmed":
      return <CheckCircle className="w-5 h-5 text-green-400" />;
    case "comment_liked":
      return <Heart className="w-5 h-5 text-red-400" />;
    default:
      return <Bell className="w-5 h-5 text-primary-400" />;
  }
}

function getRoute(n: NotificationRow): string | null {
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
  const channelRef = useRef<any>(null);
  const mountedRef = useRef(true);

  // Don't show on admin/guardian pages
  const isModPage = pathname.startsWith("/admin") || pathname.startsWith("/guardian");

  useEffect(() => {
    mountedRef.current = true;
    
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Early returns with logging
    if (!user?.id) {
      console.log("[InAppToasts] No user, skipping");
      return;
    }
    
    if (isModPage) {
      console.log("[InAppToasts] On mod page, skipping");
      return;
    }

    console.log("[InAppToasts] ========================================");
    console.log("[InAppToasts] Setting up for user:", user.id);
    console.log("[InAppToasts] Current pathname:", pathname);
    console.log("[InAppToasts] ========================================");

    // Cleanup existing
    if (channelRef.current) {
      console.log("[InAppToasts] Cleaning up old channel");
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channelName = `user-toasts-${user.id}-${Date.now()}`;
    console.log("[InAppToasts] Creating channel:", channelName);

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log("[InAppToasts] ========================================");
          console.log("[InAppToasts] 🔔 RECEIVED NOTIFICATION!");
          console.log("[InAppToasts] Payload:", payload);
          console.log("[InAppToasts] ========================================");
          
          if (!mountedRef.current) {
            console.log("[InAppToasts] Component unmounted, ignoring");
            return;
          }

          const n = payload.new as NotificationRow;
          console.log("[InAppToasts] Notification title:", n.title);
          console.log("[InAppToasts] Notification type:", n.type);

          // Play sound
          try {
            playNotificationSound();
            console.log("[InAppToasts] Sound played");
          } catch (e) {
            console.error("[InAppToasts] Sound error:", e);
          }

          // Add toast
          setToasts((prev) => {
            if (prev.some((t) => t.id === n.id)) {
              console.log("[InAppToasts] Duplicate, skipping");
              return prev;
            }
            console.log("[InAppToasts] Adding toast to state");
            return [n, ...prev].slice(0, 3);
          });

          // Notify header
          window.dispatchEvent(new Event("peja-notifications-changed"));
          console.log("[InAppToasts] Dispatched peja-notifications-changed event");

          // Auto-dismiss
          setTimeout(() => {
            if (mountedRef.current) {
              setToasts((prev) => prev.filter((t) => t.id !== n.id));
            }
          }, 6000);
        }
      )
      .subscribe((status, err) => {
        console.log("[InAppToasts] Subscription status:", status);
        if (err) console.error("[InAppToasts] Subscription error:", err);
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        console.log("[InAppToasts] Cleanup on unmount");
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, isModPage, pathname]);

  // Debug log when toasts change
  useEffect(() => {
    console.log("[InAppToasts] Toasts state changed:", toasts.length, "toasts");
  }, [toasts]);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleClick = async (n: NotificationRow) => {
    dismiss(n.id);

    try {
      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
      window.dispatchEvent(new Event("peja-notifications-changed"));
    } catch {}

    const route = getRoute(n);
    if (route) router.push(route, { scroll: false });
  };

  // Don't render on admin/guardian pages or if no user
  if (!user?.id || isModPage) {
    return null;
  }
  
  if (toasts.length === 0) {
    return null;
  }

  console.log("[InAppToasts] Rendering", toasts.length, "toasts");

  return (
    <div
      className="fixed left-0 right-0 z-[200000] flex justify-center px-3"
      style={{ top: "calc(64px + env(safe-area-inset-top, 0px) + 8px)" }}
    >
      <div className="w-full max-w-md space-y-2">
        {toasts.map((n) => (
          <div
            key={n.id}
            className="glass-float rounded-2xl border border-white/10 shadow-xl overflow-hidden animate-[toastIn_180ms_ease-out] cursor-pointer"
            onClick={() => handleClick(n)}
          >
            <div className="p-3 flex items-start gap-3">
              <div className="p-2 rounded-xl bg-dark-800/60 shrink-0">{getIcon(n.type)}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-dark-100 truncate">{n.title}</p>
                {n.body && <p className="text-xs text-dark-300 mt-0.5 line-clamp-2">{n.body}</p>}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(n.id);
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