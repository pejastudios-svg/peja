"use client";

import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { useState, useEffect } from "react";
import { useFeedCache } from "@/context/FeedContext";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { markAllAsRead } from "@/lib/notifications";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { SOS_TAGS } from "@/lib/types";
import { Skeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/context/ToastContext";
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
  UserPlus,
  UserCheck,
  UserX,
  User,
  X,
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

interface InviteModalData {
  contactId: string;
  requesterName: string;
  requesterAvatar?: string;
  relationship?: string;
  notificationId: string;
}

function NotificationRowSkeleton() {
  return (
    <div className="glass-card p-4">
      <div className="flex gap-3">
        <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-4 w-2/3 mb-2" />
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const feedCache = useFeedCache();
  const toast = useToast();

  const [notifications, setNotifications] = useState<Notification[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get("notifications:list");
      if (cached?.posts) return cached.posts as unknown as Notification[];
    }
    return [];
  });

  const [loading, setLoading] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get("notifications:list");
      if (cached?.posts && (cached.posts as unknown as Notification[]).length > 0) return false;
    }
    return true;
  });

  const [inviteModal, setInviteModal] = useState<InviteModalData | null>(null);
  const [responding, setResponding] = useState<"accept" | "decline" | null>(null);

  useEffect(() => {
    const save = () => {
      if (window.scrollY > 0) {
        feedCache.setScroll("notifications:list", window.scrollY);
      }
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [feedCache]);

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

    if (notifications.length === 0) setLoading(true);

    try {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

      await supabase
        .from("notifications")
        .delete()
        .eq("user_id", user.id)
        .eq("type", "sos_alert")
        .lt("created_at", fiveHoursAgo);

      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      const list = data || [];
      setNotifications(list);
      feedCache.setPosts("notifications:list", list as unknown as any[]);
    } catch (error) {
      console.error("Error fetching notifications:", error);
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
      await supabase.from("notifications").update({ is_read: true }).eq("id", notificationId);
      setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)));
    } catch (error) {
      console.error("Error marking as read:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    const success = await markAllAsRead(user.id);
    if (!success) {
      fetchNotifications();
    }
  };

  const handleDeleteNotification = async (e: React.MouseEvent, notificationId: string) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await supabase.from("notifications").delete().eq("id", notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    } catch (error) {
      console.error("Error deleting notification:", error);
    }
  };

  const handleInviteResponse = async (accept: boolean) => {
  if (!inviteModal || !user) return;

  setResponding(accept ? "accept" : "decline");

  try {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;

    const res = await fetch("/api/sos/respond-emergency-contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        contactId: inviteModal.contactId,
        accept,
      }),
    });

    const result = await res.json();
    console.log("[InviteResponse] API result:", res.status, result);

    if (!res.ok) {
      if (res.status === 404) {
        toast.info("This request no longer exists. It may have been deleted.");
      } else if (res.status === 409) {
        toast.info(`This request was already ${result.status || "handled"}.`);
      } else {
        toast.danger(result.error || "Failed to respond. Please try again.");
      }
      setInviteModal(null);
      return;
    }

    // Mark notification as read
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", inviteModal.notificationId);

    setNotifications((prev) =>
      prev.map((n) => (n.id === inviteModal.notificationId ? { ...n, is_read: true } : n))
    );

    toast.success(
      accept ? "Accepted! You're now their emergency contact." : "Request declined."
    );

    setInviteModal(null);
  } catch (err) {
    console.error("Failed to respond:", err);
    toast.danger("Failed to respond. Please try again.");
  } finally {
    setResponding(null);
  }
};

 const handleNotificationClick = (notification: Notification) => {
    console.log("=== NOTIFICATION CLICKED ===");
    console.log("notification.data:", JSON.stringify(notification.data));

    // Mark as read first
    if (!notification.is_read) {
      handleMarkAsRead(notification.id);
    }

    const data = notification.data || {};

    console.log("data.type:", data.type);

    // Handle emergency contact invite - show modal directly, NO database check
    if (data.type === "emergency_contact_invite") {
      console.log("SHOWING INVITE MODAL with contactId:", data.contact_id);
      setInviteModal({
        contactId: data.contact_id,
        requesterName: data.requester_name || "Someone",
        requesterAvatar: data.requester_avatar,
        relationship: data.relationship,
        notificationId: notification.id,
      });
      return;
    }

    // Handle emergency contact response
    if (data.type === "emergency_contact_response") {
      router.push("/emergency-contacts");
      return;
    }

    switch (notification.type) {
      case "sos_alert": {
        const id = data.sos_id;
        const lat = data.latitude;
        const lng = data.longitude;

        const qs = new URLSearchParams();
        if (id) qs.set("sos", String(id));
        if (lat != null) qs.set("lat", String(lat));
        if (lng != null) qs.set("lng", String(lng));

        router.push(`/map${qs.toString() ? `?${qs.toString()}` : ""}`, { scroll: false });
        router.refresh();
        break;
      }

      case "nearby_incident":
      case "post_confirmed":
      case "post_comment":
      case "comment_liked":
      case "comment_reply":
        if (data.post_id) {
          router.push(`/post/${data.post_id}`);
        }
        break;

      case "guardian_approved":
      case "guardian_rejected":
        router.push("/become-guardian");
        break;

      case "dm_message":
      case "dm_reaction":
        if (data.conversation_id) {
          router.push(`/messages/${data.conversation_id}`, { scroll: false });
        }
        break;

      default:
        if (data.conversation_id) {
          router.push(`/messages/${data.conversation_id}`, { scroll: false });
        } else if (data.post_id) {
          router.push(`/post/${data.post_id}`);
        }
        break;
    }
  };

  const getNotificationIcon = (notification: Notification) => {
    const data = notification.data || {};

    if (data.type === "emergency_contact_invite") {
      return <UserPlus className="w-5 h-5 text-yellow-400" />;
    }
    if (data.type === "emergency_contact_response") {
      return data.accepted ? (
        <UserCheck className="w-5 h-5 text-green-400" />
      ) : (
        <UserX className="w-5 h-5 text-red-400" />
      );
    }

    switch (notification.type) {
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
      case "comment_reply":
        return <MessageCircle className="w-5 h-5 text-blue-400" />;
      default:
        return <Bell className="w-5 h-5 text-primary-400" />;
    }
  };

  const getNotificationBgColor = (notification: Notification) => {
    const data = notification.data || {};

    if (data.type === "emergency_contact_invite") return "bg-yellow-500/20";
    if (data.type === "emergency_contact_response") {
      return data.accepted ? "bg-green-500/20" : "bg-red-500/20";
    }
    if (notification.type === "sos_alert") return "bg-red-500/20";
    return "bg-dark-700";
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <PullToRefresh onRefresh={async () => { await fetchNotifications(); }}>
      <div className="min-h-screen pb-20 lg:pb-0">
        <Header variant="back" title="Notifications" onBack={() => router.back()} onCreateClick={() => router.push("/create")} />

        <main className="pt-16 lg:pl-64">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-dark-100">Notifications</h1>
                {unreadCount > 0 && <p className="text-sm text-dark-400">{unreadCount} unread</p>}
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

            {loading && notifications.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <NotificationRowSkeleton key={i} />
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-12">
                <Bell className="w-12 h-12 text-dark-600 mx-auto mb-4" />
                <p className="text-dark-400 mb-2">No notifications yet</p>
                <p className="text-sm text-dark-500">You'll be notified about incidents near you</p>
              </div>
            ) : (
              <div className="space-y-2">
                {loading && (
                  <div className="flex justify-center py-2">
                    <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                  </div>
                )}
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        handleNotificationClick(notification);
                      }
                    }}
                    className={`glass-card p-4 cursor-pointer transition-all active:scale-[0.98] active:bg-white/10 hover:bg-white/5 select-none ${
                      !notification.is_read ? "border-l-4 border-l-primary-500" : ""
                    }`}
                    style={{ WebkitTapHighlightColor: "transparent" }}
                  >
                    <div className="flex gap-3">
                      <div className={`p-2 rounded-lg shrink-0 ${getNotificationBgColor(notification)}`}>
                        {getNotificationIcon(notification)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium ${notification.is_read ? "text-dark-300" : "text-dark-100"}`}>
                              {notification.title}
                            </p>
                            {notification.body && (
                              <p className="text-sm text-dark-400 mt-0.5 line-clamp-2">{notification.body}</p>
                            )}
                            {notification.data?.type === "emergency_contact_invite" && (
                              <p className="text-xs text-yellow-400 mt-1 font-medium">
                                Tap to accept or decline
                              </p>
                            )}
                          </div>

                          {notification.type === "sos_alert" && (
                            <div className="mt-2 space-y-2">
                              {notification.data?.tag && (
                                <p className="text-xs text-red-300">
                                  {SOS_TAGS.find((t) => t.id === notification.data.tag)?.label || "Emergency"}
                                </p>
                              )}
                              {notification.data?.message && (
                                <p className="text-sm text-dark-300">{notification.data.message}</p>
                              )}
                              {notification.data?.voice_note_url && (
                                <audio src={notification.data.voice_note_url} controls className="w-full" />
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
                          {!notification.is_read && <span className="w-2 h-2 bg-primary-500 rounded-full" />}
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

        {/* Emergency Contact Invite Modal */}
        <Modal
          isOpen={!!inviteModal}
          onClose={() => {
            if (!responding) setInviteModal(null);
          }}
          title="Emergency Contact Request"
        >
          {inviteModal && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 glass-sm rounded-xl">
                <div className="w-14 h-14 rounded-full bg-yellow-600/20 flex items-center justify-center shrink-0 overflow-hidden">
                  {inviteModal.requesterAvatar ? (
                    <img
                      src={inviteModal.requesterAvatar}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-7 h-7 text-yellow-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-dark-100 text-lg">
                    {inviteModal.requesterName}
                  </p>
                  {inviteModal.relationship && (
                    <p className="text-sm text-dark-400">
                      Wants to add you as:{" "}
                      <span className="text-dark-200 font-medium">{inviteModal.relationship}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                <p className="text-sm text-orange-300">
                  If you accept, you'll receive notifications and emails when this person triggers an SOS alert.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => handleInviteResponse(false)}
                  disabled={responding !== null}
                  leftIcon={
                    responding === "decline" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <X className="w-4 h-4" />
                    )
                  }
                >
                  Decline
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => handleInviteResponse(true)}
                  disabled={responding !== null}
                  leftIcon={
                    responding === "accept" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )
                  }
                >
                  Accept
                </Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </PullToRefresh>
  );
}