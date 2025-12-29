"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { markAllAsRead } from "@/lib/notifications";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { SOS_TAGS } from "@/lib/types";
import {
  Bell,
  AlertTriangle,
  MessageCircle,
  CheckCircle,
  MapPin,
  Clock,
  Loader2,
  Trash2,
  Check,
  Heart,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: any;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
  router.prefetch("/map");
  router.prefetch("/notifications");
  router.prefetch("/profile");
}, [router]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchNotifications();
     const cleanup = setupRealtime();
     return cleanup;
    } else if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading]);

  const fetchNotifications = async () => {
  if (!user) return;

  try {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    // Delete old SOS notifications
    await supabase
      .from("notifications")
      .delete()
      .eq("user_id", user.id)
      .eq("type", "sos_alert")
      .lt("created_at", fiveHoursAgo);

    // Fetch remaining
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    setNotifications(data || []);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    setLoading(false);
  }
};

const setupRealtime = () => {
  if (!user) return () => {};

  const channel = supabase
    .channel("notifications-changes")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
      (payload) => {
        const n = payload.new as Notification;
        setNotifications((prev) => [n, ...prev]);

        // tell header to refresh count
        window.dispatchEvent(new Event("peja-notifications-changed"));
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
      (payload) => {
        const updated = payload.new as Notification;
        setNotifications((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));

        window.dispatchEvent(new Event("peja-notifications-changed"));
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
      (payload) => {
        const old = payload.old as Notification;
        setNotifications((prev) => prev.filter((x) => x.id !== old.id));

        window.dispatchEvent(new Event("peja-notifications-changed"));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
    } catch (error) {
      console.error("Error marking as read:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user) return;

    // Optimistic update
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));

    const success = await markAllAsRead(user.id);
    if (!success) {
      fetchNotifications();
    }
  };

  const handleDeleteNotification = async (e: React.MouseEvent, notificationId: string) => {
    // Prevent the click from bubbling to the parent
    e.preventDefault();
    e.stopPropagation();

    try {
      await supabase
        .from("notifications")
        .delete()
        .eq("id", notificationId);

      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    } catch (error) {
      console.error("Error deleting notification:", error);
    }
  };

  // FIXED: Proper navigation handler for mobile
  const handleNotificationClick = (notification: Notification) => {
    // Mark as read first
    if (!notification.is_read) {
      handleMarkAsRead(notification.id);
    }

    const data = notification.data || {};

    // Navigate based on notification type
    switch (notification.type) {
      case "sos_alert":
        if (data.sos_id) {
          router.push(`/map?sos=${data.sos_id}`);
        } else {
          router.push("/map");
        }
        break;
      
      case "nearby_incident":
      case "post_confirmed":
      case "post_comment":
      case "comment_liked":
        if (data.post_id) {
          router.push(`/post/${data.post_id}`);
        }
        break;
      
      case "guardian_approved":
      case "guardian_rejected":
        router.push("/become-guardian");
        break;
      
      default:
        // For any notification with a post_id, navigate to that post
        if (data.post_id) {
          router.push(`/post/${data.post_id}`);
        }
        break;
    }
  };

  const getNotificationIcon = (type: string) => {
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
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header onCreateClick={() => router.push("/create")} />

      <main className="pt-16 lg:pl-64">
        <div className="max-w-2xl mx-auto px-4 py-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-dark-100">Notifications</h1>
              {unreadCount > 0 && (
                <p className="text-sm text-dark-400">{unreadCount} unread</p>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 py-2 px-3 rounded-lg active:bg-white/10"
              >
                <Check className="w-4 h-4" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications List */}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="w-12 h-12 text-dark-600 mx-auto mb-4" />
              <p className="text-dark-400 mb-2">No notifications yet</p>
              <p className="text-sm text-dark-500">
                You'll be notified about incidents near you
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleNotificationClick(notification);
                    }
                  }}
                  className={`glass-card p-4 cursor-pointer transition-all active:scale-[0.98] active:bg-white/10 hover:bg-white/5 select-none ${
                    !notification.is_read ? "border-l-4 border-l-primary-500" : ""
                  }`}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <div className="flex gap-3">
                    {/* Icon */}
                    <div className={`p-2 rounded-lg shrink-0 ${
                      notification.type === "sos_alert" 
                        ? "bg-red-500/20" 
                        : "bg-dark-700"
                    }`}>
                      {getNotificationIcon(notification.type)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium ${
                            notification.is_read ? "text-dark-300" : "text-dark-100"
                          }`}>
                            {notification.title}
                          </p>
                          {notification.body && (
                            <p className="text-sm text-dark-400 mt-0.5 line-clamp-2">
                              {notification.body}
                            </p>
                          )}
                        </div>
                        {notification.type === "sos_alert" && (
  <div className="mt-2 space-y-2">
    {notification.data?.tag && (
      <p className="text-xs text-red-300">
        {SOS_TAGS.find(t => t.id === notification.data.tag)?.label || "Emergency"}
      </p>
    )}

    {notification.data?.message && (
      <p className="text-sm text-dark-300">
        {notification.data.message}
      </p>
    )}

    {notification.data?.voice_note_url && (
      <audio
        src={notification.data.voice_note_url}
        controls
        className="w-full"
      />
    )}
  </div>
)}
                        
                        <button
                          onClick={(e) => handleDeleteNotification(e, notification.id)}
                          className="p-2 hover:bg-white/10 rounded-lg text-dark-500 hover:text-red-400 active:bg-white/20 shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2 mt-2 text-xs text-dark-500">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        
                        {!notification.is_read && (
                          <span className="w-2 h-2 bg-primary-500 rounded-full" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}