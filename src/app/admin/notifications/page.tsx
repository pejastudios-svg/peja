"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Bell, Check, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";

type AdminNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: any;
  is_read: boolean;
  created_at: string;
};

export default function AdminNotificationsPage() {
  function AdminNotifSkeletonRow() {
    const unread = items.filter((x) => !x.is_read);
  const read = items.filter((x) => x.is_read);

  const typeTone = (t: string) => {
    if (t === "flagged_post") return "border-red-500/40 bg-red-500/10";
    if (t === "guardian_application") return "border-primary-500/40 bg-primary-500/10";
    return "border-white/10 bg-white/5";
  };

  return (
    <HudShell
      title="Admin Notifications"
      subtitle="Real-time operational alerts for moderation and guardians"
      right={
        <div className="flex items-center gap-2">
          {unreadCount > 0 && <span className="pill pill-purple">{unreadCount} unread</span>}
          {unreadCount > 0 && (
            <GlowButton onClick={markAllRead} disabled={loading}>
              Mark all read
            </GlowButton>
          )}
        </div>
      }
    >
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: stream */}
        <div className="lg:col-span-2">
          <HudPanel
            title="Stream"
            subtitle="Unread first. Tap a row to open the relevant admin screen."
            right={loading ? <span className="pill pill-purple">Loading</span> : <span className="pill pill-purple">Live</span>}
          >
            {loading && items.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <AdminNotifSkeletonRow key={i} />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-dark-400">No notifications yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {unread.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (!n.is_read) markRead(n.id);

                      if (n.type === "flagged_post") {
                        router.push(`/admin/flagged?open=${encodeURIComponent(n.data?.flagged_id || "")}`);
                        return;
                      }
                      if (n.type === "guardian_application") {
                        router.push(`/admin/guardians?app=${encodeURIComponent(n.data?.application_id || "")}`);
                        return;
                      }
                    }}
                    className={`relative cursor-pointer rounded-2xl border ${typeTone(n.type)} p-4 hover:bg-white/10 transition-colors`}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary-500/70 rounded-l-2xl" />

                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-dark-100">{n.title}</p>
                        {n.body && <p className="text-sm text-dark-300 mt-1">{n.body}</p>}
                        <p className="text-xs text-dark-500 mt-2">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </p>
                      </div>

                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeOne(n.id);
                        }}
                        className="p-2 hover:bg-white/10 rounded-lg text-dark-500 hover:text-red-300"
                        aria-label="Delete notification"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {read.length > 0 && (
                  <div className="pt-4 mt-4 border-t border-white/10">
                    <p className="text-xs text-dark-500 uppercase tracking-wide mb-2">Read</p>

                    <div className="space-y-2">
                      {read.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            if (n.type === "flagged_post") {
                              router.push(`/admin/flagged?open=${encodeURIComponent(n.data?.flagged_id || "")}`);
                              return;
                            }
                            if (n.type === "guardian_application") {
                              router.push(`/admin/guardians?app=${encodeURIComponent(n.data?.application_id || "")}`);
                              return;
                            }
                          }}
                          className={`cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition-colors`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-dark-200">{n.title}</p>
                              {n.body && <p className="text-sm text-dark-400 mt-1">{n.body}</p>}
                              <p className="text-xs text-dark-600 mt-2">
                                {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                              </p>
                            </div>

                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                removeOne(n.id);
                              }}
                              className="p-2 hover:bg-white/10 rounded-lg text-dark-600 hover:text-red-300"
                              aria-label="Delete notification"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </HudPanel>
        </div>

        {/* Right: quick status */}
        <div className="lg:col-span-1">
          <HudPanel title="Status" subtitle="Operational summary">
            <div className="space-y-3">
              <div className="hud-panel p-4">
                <p className="text-xs text-dark-500 uppercase tracking-wide">Unread</p>
                <p className="text-2xl font-bold text-dark-100 mt-1">{unreadCount}</p>
              </div>

              <div className="hud-panel p-4">
                <p className="text-xs text-dark-500 uppercase tracking-wide">Last refresh</p>
                <p className="text-sm text-dark-200 mt-1">
                  {items[0]?.created_at
                    ? formatDistanceToNow(new Date(items[0].created_at), { addSuffix: true })
                    : "No data"}
                </p>
              </div>

              <div className="p-4 rounded-2xl border border-primary-500/20 bg-primary-600/10 text-sm text-dark-300">
                Tip: respond to flagged posts quickly to keep the feed trustworthy.
              </div>
            </div>
          </HudPanel>
        </div>
      </div>
    </HudShell>
  );
}
    useScrollRestore("admin:notifications");
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchItems = async () => {
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setItems([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("admin_notifications")
      .select("*")
      .eq("recipient_id", uid)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) console.error(error);
    setItems((data || []) as any);
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();

    let channel: any;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;

      channel = supabase
        .channel("admin-notifications")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "admin_notifications", filter: `recipient_id=eq.${uid}` },
          () => fetchItems()
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const unreadCount = items.filter((x) => !x.is_read).length;

  const markAllRead = async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;

    // optimistic
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));

    await supabase
      .from("admin_notifications")
      .update({ is_read: true })
      .eq("recipient_id", uid)
      .eq("is_read", false);
  };

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: true } : x)));
    await supabase.from("admin_notifications").update({ is_read: true }).eq("id", id);
  };

  const removeOne = async (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    await supabase.from("admin_notifications").delete().eq("id", id);
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
      <AdminNotifSkeletonRow key={i} />
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
  onClick={() => {
    if (!n.is_read) markRead(n.id);

    if (n.type === "flagged_post") {
      router.push(`/admin/flagged?open=${encodeURIComponent(n.data?.flagged_id || "")}`);
      return;
    }

    if (n.type === "guardian_application") {
      router.push(`/admin/guardians?app=${encodeURIComponent(n.data?.application_id || "")}`);
      return;
    }
  }}
              className={`glass-card p-4 cursor-pointer hover:bg-white/5 transition-colors ${
                !n.is_read ? "border-l-4 border-l-primary-500" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-medium ${n.is_read ? "text-dark-200" : "text-dark-100"}`}>
                    {n.title}
                  </p>
                  {n.body && <p className="text-sm text-dark-400 mt-1">{n.body}</p>}
                  <p className="text-xs text-dark-500 mt-2">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
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

              {/* Data preview (optional for debugging) */}
              {/* <pre className="text-xs text-dark-500 mt-2">{JSON.stringify(n.data, null, 2)}</pre> */}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}