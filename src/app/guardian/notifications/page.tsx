"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Bell, Check, Trash2, Flag, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";

type GuardianNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: any;
  is_read: boolean;
  created_at: string;
};

function GuardianNotifSkeletonRow() {
  return (
    <div className="glass-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-2/3 mb-2" />
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
    </div>
  );
}

export default function GuardianNotificationsPage() {
  useScrollRestore("guardian:notifications");
  
  const [items, setItems] = useState<GuardianNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const channelRef = useRef<any>(null);

  // Dispatch event to refresh sidebar badge
  const refreshBadge = () => {
    window.dispatchEvent(new Event("guardian-badge-refresh"));
  };

  const fetchItems = async (silent = false) => {
    if (!silent) setLoading(true);
    
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setItems([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("guardian_notifications")
      .select("*")
      .eq("recipient_id", uid)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) console.error(error);
    setItems((data || []) as any);
    if (!silent) setLoading(false);
  };

  useEffect(() => {
  fetchItems();

  const setupRealtime = async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Use unique channel name with timestamp
    const channelName = `guardian-notifications-page-${uid}-${Date.now()}`;
    console.log("[Guardian Notifications] Setting up channel:", channelName);

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { 
          event: "*", 
          schema: "public", 
          table: "guardian_notifications", 
          filter: `recipient_id=eq.${uid}` 
        },
        (payload) => {
          console.log("[Guardian Notifications] Realtime event:", payload.eventType);
          fetchItems(true);
        }
      )
      .subscribe((status) => {
        console.log("[Guardian Notifications] Subscription status:", status);
      });

    channelRef.current = channel;
  };

  setupRealtime();

  // Also listen for flagged content changes
  const handleFlaggedChange = () => {
    console.log("[Guardian Notifications] Flagged content changed, refreshing...");
    fetchItems(true);
  };
  
  window.addEventListener("guardian-badge-refresh", handleFlaggedChange);

  return () => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    window.removeEventListener("guardian-badge-refresh", handleFlaggedChange);
  };
}, []);

  const unreadCount = items.filter((x) => !x.is_read).length;

  const markAllRead = async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;

    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));

    await supabase
      .from("guardian_notifications")
      .update({ is_read: true })
      .eq("recipient_id", uid)
      .eq("is_read", false);

    refreshBadge();
  };

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: true } : x)));
    await supabase.from("guardian_notifications").update({ is_read: true }).eq("id", id);
    refreshBadge();
  };

  const removeOne = async (id: string) => {
    const wasUnread = items.find(x => x.id === id)?.is_read !== true;
    setItems((prev) => prev.filter((x) => x.id !== id));
    await supabase.from("guardian_notifications").delete().eq("id", id);
    if (wasUnread) refreshBadge();
  };

  const getIcon = (type: string) => {
    if (type === "flagged_post" || type === "flagged_comment") {
      return <Flag className="w-4 h-4 text-red-400" />;
    }
    return <Bell className="w-4 h-4 text-primary-400" />;
  };

  const openNotification = (n: GuardianNotification) => {
    if (!n.is_read) markRead(n.id);

    if (n.type === "flagged_post" || n.type === "flagged_comment") {
      router.push(`/guardian/queue?review=${encodeURIComponent(n.data?.flagged_id || "")}`);
      return;
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100 flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary-400" />
            Notifications
          </h1>
          {unreadCount > 0 && <p className="text-dark-400 mt-1">{unreadCount} unread</p>}
        </div>

        {unreadCount > 0 && (
          <Button variant="secondary" onClick={markAllRead} leftIcon={<Check className="w-4 h-4" />}>
            Mark all read
          </Button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <GuardianNotifSkeletonRow key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="glass-card text-center py-10">
          <p className="text-dark-400">No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {loading && (
            <div className="flex justify-center py-2">
              <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
            </div>
          )}
          {items.map((n) => (
            <div
              key={n.id}
              onClick={() => openNotification(n)}
              className={`glass-card p-4 cursor-pointer hover:bg-white/5 transition-colors ${
                !n.is_read ? "border-l-4 border-l-primary-500" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${!n.is_read ? "bg-dark-800" : "bg-dark-800/50 opacity-50"}`}>
                    {getIcon(n.type)}
                  </div>
                  <div className="min-w-0">
                    <p className={`font-medium ${n.is_read ? "text-dark-200" : "text-dark-100"}`}>
                      {n.title}
                    </p>
                    {n.body && <p className="text-sm text-dark-400 mt-1 line-clamp-2">{n.body}</p>}
                    <p className="text-xs text-dark-500 mt-2">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeOne(n.id);
                  }}
                  className="p-2 hover:bg-white/10 rounded-lg text-dark-500 hover:text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}