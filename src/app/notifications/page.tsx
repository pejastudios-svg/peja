"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Sidebar } from "@/components/layout/Sidebar";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && user) {
      fetchNotifications();
    } else if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading]);

  const fetchNotifications = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
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

  const markAllAsRead = async () => {
    if (!user) return;

    try {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (error) {
      console.error("Error marking all as read:", error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
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

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (!notification.is_read) {
      markAsRead(notification.id);
    }

    // Navigate based on type
    const data = notification.data || {};
    
    if (notification.type === "sos_alert" && data.sos_id) {
      // Could navigate to a SOS detail page or map
      router.push(`/map?sos=${data.sos_id}`);
    } else if (notification.type === "nearby_incident" && data.post_id) {
      router.push(`/post/${data.post_id}`);
    } else if (notification.type === "comment" && data.post_id) {
      router.push(`/post/${data.post_id}`);
    } else if (notification.type === "confirmation" && data.post_id) {
      router.push(`/post/${data.post_id}`);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "sos_alert":
        return <AlertTriangle className="w-5 h-5 text-red-400" />;
      case "nearby_incident":
        return <MapPin className="w-5 h-5 text-orange-400" />;
      case "comment":
        return <MessageCircle className="w-5 h-5 text-blue-400" />;
      case "confirmation":
        return <CheckCircle className="w-5 h-5 text-green-400" />;
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
      <Header
        onMenuClick={() => setSidebarOpen(true)}
        onCreateClick={() => router.push("/create")}
      />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

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
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
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
                  className={`glass-card p-4 cursor-pointer transition-all hover:bg-white/5 ${
                    !notification.is_read ? "border-l-4 border-l-primary-500" : ""
                  }`}
                >
                  <div className="flex gap-3">
                    {/* Icon */}
                    <div className={`p-2 rounded-lg flex-shrink-0 ${
                      notification.type === "sos_alert" 
                        ? "bg-red-500/20" 
                        : "bg-dark-700"
                    }`}>
                      {getNotificationIcon(notification.type)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
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
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNotification(notification.id);
                          }}
                          className="p-1 hover:bg-white/10 rounded text-dark-500 hover:text-red-400"
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