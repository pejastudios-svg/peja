"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Skeleton } from "@/components/ui/Skeleton";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";
import { Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type AdminNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: any;
  is_read: boolean | null;
  created_at: string;
};

function AdminNotifSkeletonRow() {
  return (
    <div className="hud-panel p-4">
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

export default function AdminNotificationsPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [items, setItems] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchingRef = useRef(false);
  const debounceRef = useRef<any>(null);

  const uid = user?.id || null;

  const unread = useMemo(() => items.filter((x) => x.is_read !== true), [items]);
  const read = useMemo(() => items.filter((x) => x.is_read === true), [items]);
  const unreadCount = unread.length;

  const typeTone = (t: string) => {
    if (t === "flagged_post") return "border-red-500/35 bg-red-500/10";
    if (t === "guardian_application") return "border-primary-500/35 bg-primary-500/10";
    return "border-white/10 bg-white/5";
  };

  const fetchItems = async (silent = false) => {
    if (!uid) return;
    if (fetchingRef.current) return;

    fetchingRef.current = true;
    if (!silent) setLoading(true);

    try {
      const { data, error } = await supabase
        .from("admin_notifications")
        .select("*")
        .eq("recipient_id", uid)
        .order("created_at", { ascending: false })
        .limit(80);

      if (error) console.error(error);
      setItems((data || []) as any);
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!uid) return;

    fetchItems(false);

    const channel = supabase
      .channel(`admin-notifications-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_notifications", filter: `recipient_id=eq.${uid}` },
        () => {
          // debounce refresh to avoid storms
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => fetchItems(true), 250);
        }
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const markAllRead = async () => {
    if (!uid) return;

    // optimistic
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));

    await supabase
      .from("admin_notifications")
      .update({ is_read: true })
      .eq("recipient_id", uid)
      .neq("is_read", true);
  };

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: true } : x)));
    await supabase.from("admin_notifications").update({ is_read: true }).eq("id", id);
  };

  const removeOne = async (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    await supabase.from("admin_notifications").delete().eq("id", id);
  };

  const openNotification = async (n: AdminNotification) => {
    if (n.is_read !== true) await markRead(n.id);

    if (n.type === "flagged_post") {
      router.push(`/admin/flagged?open=${encodeURIComponent(n.data?.flagged_id || "")}`);
      return;
    }

    if (n.type === "guardian_application") {
      router.push(`/admin/guardians?app=${encodeURIComponent(n.data?.application_id || "")}`);
      return;
    }

    router.push("/admin/notifications");
  };

  return (
    <HudShell
      title="Admin Notifications"
      subtitle="Operational alerts for moderation and guardian intake"
      right={
        <div className="flex items-center gap-2">
          {unreadCount > 0 && <span className="pill pill-purple">{unreadCount} unread</span>}
          {unreadCount > 0 && <GlowButton onClick={markAllRead}>Mark all read</GlowButton>}
        </div>
      }
    >
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <HudPanel
            title="Stream"
            subtitle="Unread first. Tap a row to open the relevant admin screen."
            right={<span className="pill pill-purple">{loading ? "Loading" : "Live"}</span>}
          >
            {loading && items.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
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
                    onClick={() => openNotification(n)}
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
                          onClick={() => openNotification(n)}
                          className="cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition-colors"
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

        <div className="lg:col-span-1">
          <HudPanel title="Status" subtitle="Quick summary">
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-dark-500 uppercase tracking-wide">Unread</p>
                <p className="text-2xl font-bold text-dark-100 mt-1">{unreadCount}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-dark-500 uppercase tracking-wide">Latest</p>
                <p className="text-sm text-dark-200 mt-1">
                  {items[0]?.created_at
                    ? formatDistanceToNow(new Date(items[0].created_at), { addSuffix: true })
                    : "No data"}
                </p>
              </div>

              <div className="p-4 rounded-2xl border border-primary-500/20 bg-primary-600/10 text-sm text-dark-300">
                Tip: handle flagged posts quickly to keep the feed trustworthy.
              </div>
            </div>
          </HudPanel>
        </div>
      </div>
    </HudShell>
  );
}