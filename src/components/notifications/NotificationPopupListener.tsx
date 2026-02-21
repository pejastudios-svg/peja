"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { playNotificationSound } from "@/lib/notificationSound";
import { X, Flag, Bell, AlertTriangle, MessageCircle } from "lucide-react";

type NotifRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, any>;
  created_at: string;
  recipient_id?: string;
  user_id?: string;
};

interface Props {
  table: "notifications" | "admin_notifications" | "guardian_notifications";
  userColumn: "user_id" | "recipient_id";
  onNotification?: () => void;
}

export function NotificationPopupListener({ table, userColumn, onNotification }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  const [popup, setPopup] = useState<NotifRow | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        console.log(`[PopupListener:${table}] Got user:`, user.id);
        setUserId(user.id);
      }
    };
    getUser();
  }, [table]);

  useEffect(() => {
    if (!userId) {
      console.log(`[PopupListener:${table}] No userId yet, waiting...`);
      return;
    }

    console.log(`[PopupListener:${table}] ========================================`);
    console.log(`[PopupListener:${table}] Setting up listener`);
    console.log(`[PopupListener:${table}] Table: ${table}`);
    console.log(`[PopupListener:${table}] User ID: ${userId}`);
    console.log(`[PopupListener:${table}] Filter: ${userColumn}=eq.${userId}`);
    console.log(`[PopupListener:${table}] ========================================`);

    // Cleanup existing
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channelName = `popup-${table}-${userId}-${Date.now()}`;
    console.log(`[PopupListener:${table}] Channel name:`, channelName);

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: table,
          filter: `${userColumn}=eq.${userId}`,
        },
        (payload) => {
          console.log(`[PopupListener:${table}] ========================================`);
          console.log(`[PopupListener:${table}] 🔔 RECEIVED NOTIFICATION!`);
          console.log(`[PopupListener:${table}] Payload:`, JSON.stringify(payload.new, null, 2));
          console.log(`[PopupListener:${table}] ========================================`);

          const row = payload.new as NotifRow;

          setPopup(row);
          
          try {
            playNotificationSound();
            console.log(`[PopupListener:${table}] Sound played`);
          } catch (e) {
            console.error(`[PopupListener:${table}] Sound error:`, e);
          }

          onNotification?.();

          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            console.log(`[PopupListener:${table}] Auto-dismissing popup`);
            setPopup(null);
          }, 8000);
        }
      )
      .subscribe((status, err) => {
        console.log(`[PopupListener:${table}] Subscription status:`, status);
        if (err) console.error(`[PopupListener:${table}] Subscription error:`, err);
      });

    channelRef.current = channel;

    return () => {
      console.log(`[PopupListener:${table}] Cleaning up channel`);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [userId, table, userColumn, onNotification]);

  // Debug when popup changes
  useEffect(() => {
    if (popup) {
      console.log(`[PopupListener:${table}] Popup is now showing:`, popup.title);
    } else {
      console.log(`[PopupListener:${table}] Popup is now hidden`);
    }
  }, [popup, table]);

  if (!popup) return null;

  const getRoute = (): string | null => {
  const data = popup.data || {};

  if (table === "admin_notifications") {
    if (popup.type === "flagged_post" || popup.type === "flagged_comment") {
      return `/admin/flagged?open=${encodeURIComponent(data.flagged_id || "")}`;
    }
    // Add escalated types
    if (popup.type === "escalated_post" || popup.type === "escalated_comment") {
      return `/admin/flagged?open=${encodeURIComponent(data.flagged_id || "")}`;
    }
    if (popup.type === "guardian_application") {
      return `/admin/guardians?app=${encodeURIComponent(data.application_id || "")}`;
    }
    return "/admin/notifications";
  }

  if (table === "guardian_notifications") {
    if (popup.type === "flagged_post" || popup.type === "flagged_comment") {
      return `/guardian/queue?review=${encodeURIComponent(data.flagged_id || "")}`;
    }
    return "/guardian/notifications";
  }

  if (popup.type === "sos_alert") {
    return data.sos_id ? `/map?sos=${encodeURIComponent(data.sos_id)}` : "/map";
  }
  if (data.post_id) {
    return `/post/${encodeURIComponent(data.post_id)}`;
  }
  return "/notifications";
};

  const handleClick = async () => {
    try {
      await supabase
        .from(table)
        .update({ is_read: true })
        .eq("id", popup.id);

      onNotification?.();
    } catch (e) {
      console.error(`[PopupListener:${table}] Failed to mark as read:`, e);
    }

    setPopup(null);

    const route = getRoute();
    if (!route) return;

    // Close any open modals/overlays before navigating
    if ((window as any).__pejaPostModalOpen) {
      window.dispatchEvent(new Event("peja-close-post"));
      // Wait for the modal close animation to finish before navigating
      setTimeout(() => {
        router.push(route);
      }, 350);
      return;
    }

    if ((window as any).__pejaOverlayOpen) {
      router.back();
      setTimeout(() => {
        router.push(route);
      }, 350);
      return;
    }

    router.push(route);
  };

  const getIcon = () => {
  if (popup.type === "flagged_post" || popup.type === "flagged_comment") {
    return <Flag className="w-5 h-5 text-red-400" />;
  }
  // Add escalated types with orange color
  if (popup.type === "escalated_post" || popup.type === "escalated_comment") {
    return <AlertTriangle className="w-5 h-5 text-orange-400" />;
  }
  if (popup.type === "sos_alert") {
    return <AlertTriangle className="w-5 h-5 text-red-400" />;
  }
  if (popup.type === "post_comment" || popup.type === "comment_reply") {
    return <MessageCircle className="w-5 h-5 text-blue-400" />;
  }
  return <Bell className="w-5 h-5 text-primary-400" />;
};

  return (
    <div className="fixed bottom-4 right-4 z-[100000] max-w-sm animate-[slideUp_200ms_ease-out]">
      <div className="bg-dark-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="p-2 rounded-xl bg-dark-800 shrink-0">{getIcon()}</div>

          <button type="button" onClick={handleClick} className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-white">{popup.title}</p>
            {popup.body && <p className="text-xs text-dark-300 mt-1 line-clamp-2">{popup.body}</p>}
            <p className="text-[11px] text-primary-400 mt-2">Click to open</p>
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