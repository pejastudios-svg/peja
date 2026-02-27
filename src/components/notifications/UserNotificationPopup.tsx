"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { playNotificationSound } from "@/lib/notificationSound";
import { X, Bell, AlertTriangle, MessageCircle, CheckCircle, Heart, MapPin } from "lucide-react";

type NotifRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, any>;
  created_at: string;
  user_id: string;
};

export function UserNotificationPopup() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  const [popup, setPopup] = useState<NotifRow | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Keep pathname ref current
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Don't render on admin/guardian pages (they have their own)
  const isModPage = pathname.startsWith("/admin") || pathname.startsWith("/guardian");

  useEffect(() => {
    if (!user?.id || isModPage) return;


    const channel = supabase
      .channel(`user-popup-${user.id}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as NotifRow;

          // Suppress completely if user is currently in the chat this DM belongs to
          if (
            (row.type === "dm_message" || row.type === "dm_reaction") &&
            row.data?.conversation_id
          ) {
            const activeConvo = (window as any).__pejaActiveConversationId;
            if (activeConvo === row.data.conversation_id) {
              supabase
                .from("notifications")
                .update({ is_read: true })
                .eq("id", row.id)
                .then(() => {});
              window.dispatchEvent(new Event("peja-notifications-changed"));
              return;
            }
          }

          setPopup(row);
          playNotificationSound();

          // Notify header to refresh badge
          window.dispatchEvent(new Event("peja-notifications-changed"));

          // Auto-dismiss
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setPopup(null), 8000);
        }
      )
      .subscribe((status) => {
      });

    return () => {
      supabase.removeChannel(channel);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user?.id, isModPage]);

  if (!user?.id || isModPage || !popup) return null;

  const getRoute = (): string | null => {
    const data = popup.data || {};

    if (popup.type === "sos_alert") {
      return data.sos_id ? `/map?sos=${encodeURIComponent(data.sos_id)}` : "/map";
    }
    if (data.post_id) {
      return `/post/${encodeURIComponent(data.post_id)}`;
    }
    return "/notifications";
  };

  const handleClick = async () => {
    // Mark as read
    try {
      await supabase.from("notifications").update({ is_read: true }).eq("id", popup.id);
      window.dispatchEvent(new Event("peja-notifications-changed"));
    } catch {}

    setPopup(null);

    const route = getRoute();
    if (route) router.push(route);
  };

  const getIcon = () => {
    switch (popup.type) {
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
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100000] max-w-sm animate-[slideUp_200ms_ease-out]">
      <div className="bg-dark-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="p-2 rounded-xl bg-dark-800 shrink-0">{getIcon()}</div>

          <button type="button" onClick={handleClick} className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-white">{popup.title}</p>
            {popup.body && <p className="text-xs text-dark-300 mt-1 line-clamp-2">{popup.body}</p>}
            <p className="text-[11px] text-primary-400 mt-2">Tap to view</p>
          </button>

          <button
            type="button"
            onClick={() => setPopup(null)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-dark-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}