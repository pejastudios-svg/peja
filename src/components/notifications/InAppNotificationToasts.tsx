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
    case "dm_message":                                       
      return <MessageCircle className="w-5 h-5 text-primary-400" />;  
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
    case "dm_message":                                                                   
      return data.conversation_id ? `/messages/${encodeURIComponent(data.conversation_id)}` : "/messages"; 
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

  const isModPage = pathname.startsWith("/admin") || pathname.startsWith("/guardian");

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    if (isModPage) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channelName = `user-toasts-${user.id}-${Date.now()}`;

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
          if (!mountedRef.current) return;

          const n = payload.new as NotificationRow;

          // Suppress completely if user is currently in the chat this DM belongs to
          if (
            (n.type === "dm_message" || n.type === "dm_reaction") &&
            n.data?.conversation_id
          ) {
            const activeConvo = (window as any).__pejaActiveConversationId;
            if (activeConvo === n.data.conversation_id) {
              // User is in this chat — no sound, no toast, mark as read
              supabase.from("notifications").update({ is_read: true }).eq("id", n.id).then(() => {});
              window.dispatchEvent(new Event("peja-notifications-changed"));
              return;
            }
          }

          // Play sound for notifications that weren't suppressed
          try {
            playNotificationSound();
          } catch (e) {
            console.error("[InAppToasts] Sound error:", e);
          }

          // Add toast
          setToasts((prev) => {
            if (prev.some((t) => t.id === n.id)) return prev;
            return [n, ...prev].slice(0, 3);
          });

          window.dispatchEvent(new Event("peja-notifications-changed"));

          // Auto-dismiss
          setTimeout(() => {
            if (mountedRef.current) {
              setToasts((prev) => prev.filter((t) => t.id !== n.id));
            }
          }, 6000);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, isModPage, pathname]);

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

  if (!user?.id || isModPage) return null;
  if (toasts.length === 0) return null;

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