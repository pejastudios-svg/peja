"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { playNotificationSound } from "@/lib/notificationSound";
import { useRouter, usePathname } from "next/navigation";
import { X, Flag, Bell } from "lucide-react";

type NotifRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: any;
  is_read: boolean;
  created_at: string;
  recipient_id: string;
};

interface Props {
  onNewNotification?: () => void;
}

export default function GuardianInAppToasts({ onNewNotification }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [toasts, setToasts] = useState<NotifRow[]>([]);
  const channelRef = useRef<any>(null);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Only run on guardian pages
    if (!pathname.startsWith("/guardian")) return;

    const setupSubscription = async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;

      userIdRef.current = uid;

      // Cleanup any existing channel
      if (channelRef.current) {
        await supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      // Create unique channel name
      const channelName = `guardian-toast-${uid}-${Date.now()}`;
      console.log("[GuardianToast] Setting up channel:", channelName);

      const channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "guardian_notifications",
            filter: `recipient_id=eq.${uid}`,
          },
          (payload) => {
            const notification = payload.new as NotifRow;
            console.log("[GuardianToast] Received notification:", notification.title);

            // Play sound
            playNotificationSound();

            // Add to toasts (max 3)
            setToasts((prev) => {
              if (prev.some((t) => t.id === notification.id)) return prev;
              return [notification, ...prev].slice(0, 3);
            });

            // Notify parent to refresh badge count
            onNewNotification?.();

            // Auto-dismiss after 6 seconds
            setTimeout(() => {
              setToasts((prev) => prev.filter((t) => t.id !== notification.id));
            }, 6000);
          }
        )
        .subscribe((status) => {
          console.log("[GuardianToast] Subscription status:", status);
        });

      channelRef.current = channel;
    };

    setupSubscription();

    return () => {
      if (channelRef.current) {
        console.log("[GuardianToast] Cleaning up channel");
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [pathname, onNewNotification]);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleToastClick = async (notification: NotifRow) => {
    dismissToast(notification.id);

    // Mark as read
    try {
      await supabase
        .from("guardian_notifications")
        .update({ is_read: true })
        .eq("id", notification.id);
      
      onNewNotification?.();
    } catch (e) {
      console.error("[GuardianToast] Failed to mark as read:", e);
    }

    // Navigate based on type
    const data = notification.data || {};
    if (notification.type === "flagged_post" || notification.type === "flagged_comment") {
      router.push(`/guardian/queue?review=${encodeURIComponent(data.flagged_id || "")}`);
    } else {
      router.push("/guardian/notifications");
    }
  };

  // Don't render on non-guardian pages
  if (!pathname.startsWith("/guardian")) return null;
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed left-0 right-0 z-[100000] flex justify-center px-4"
      style={{ top: "calc(70px + env(safe-area-inset-top, 0px))" }}
    >
      <div className="w-full max-w-md space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => handleToastClick(toast)}
            className="bg-dark-900/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl p-4 cursor-pointer animate-[slideDown_200ms_ease-out] hover:bg-dark-800/95 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-red-500/20 shrink-0">
                <Flag className="w-5 h-5 text-red-400" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {toast.title}
                </p>
                {toast.body && (
                  <p className="text-xs text-dark-300 mt-1 line-clamp-2">
                    {toast.body}
                  </p>
                )}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dismissToast(toast.id);
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 text-dark-400 shrink-0"
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