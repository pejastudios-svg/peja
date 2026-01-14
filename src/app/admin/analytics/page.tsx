"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, TrendingUp, Users, Clock, MousePointerClick, BarChart3 } from "lucide-react";
import { subDays } from "date-fns";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";

type MetricCard = { label: string; value: string | number; icon: any; hint?: string };

export default function AdminAnalyticsPage() {
    useScrollRestore("admin:analytics");
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalPosts: 0,
    pendingFlags: 0,
    activeSOS: 0,

    dau: 0,
    wau: 0,
    mau: 0,
    avgSessionMin: 0,

    pageViews24h: 0,
    postOpens24h: 0,
    watchOpens24h: 0,
  });

  const [topScreens, setTopScreens] = useState<{ screen: string; count: number }[]>([]);
  const [topEvents, setTopEvents] = useState<{ event_name: string; count: number }[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const now = new Date();
      const d1 = subDays(now, 1).toISOString();
      const d7 = subDays(now, 7).toISOString();
      const d30 = subDays(now, 30).toISOString();

      try {
        // Core counts (existing tables)
        const [
          totalUsersRes,
          activeUsersRes,
          totalPostsRes,
          pendingFlagsRes,
          activeSOSRes,
        ] = await Promise.all([
          supabase.from("users").select("*", { count: "exact", head: true }),
          supabase.from("users").select("*", { count: "exact", head: true }).eq("status", "active"),
          supabase.from("posts").select("*", { count: "exact", head: true }),
          supabase.from("flagged_content").select("*", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("sos_alerts").select("*", { count: "exact", head: true }).eq("status", "active"),
        ]);

        // Sessions: DAU/WAU/MAU
        const [dauRes, wauRes, mauRes] = await Promise.all([
          supabase.from("user_sessions").select("user_id", { count: "exact", head: false }).gte("last_seen_at", d1),
          supabase.from("user_sessions").select("user_id", { count: "exact", head: false }).gte("last_seen_at", d7),
          supabase.from("user_sessions").select("user_id", { count: "exact", head: false }).gte("last_seen_at", d30),
        ]);

        // Distinct user counting client-side (because PostgREST count is not distinct)
        const distinctCount = (rows: any[] | null | undefined) => {
          const s = new Set<string>();
          (rows || []).forEach((r) => r.user_id && s.add(r.user_id));
          return s.size;
        };

        const dau = distinctCount((dauRes as any).data);
        const wau = distinctCount((wauRes as any).data);
        const mau = distinctCount((mauRes as any).data);

        // Avg session duration last 24h
        const { data: sessions24h } = await supabase
          .from("user_sessions")
          .select("started_at,last_seen_at")
          .gte("last_seen_at", d1)
          .limit(5000);

        let avgSessionMin = 0;
        if (sessions24h && sessions24h.length > 0) {
          let sum = 0;
          let n = 0;
          for (const s of sessions24h) {
            const a = new Date(s.started_at).getTime();
            const b = new Date(s.last_seen_at).getTime();
            if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
              const mins = (b - a) / 60000;
              // cap weird long sessions
              sum += Math.min(mins, 240);
              n++;
            }
          }
          avgSessionMin = n ? Math.round((sum / n) * 10) / 10 : 0;
        }

        // Events counts last 24h
        const { data: events24h } = await supabase
          .from("app_events")
          .select("event_name,screen")
          .gte("created_at", d1)
          .limit(10000);

        const pageViews24h = (events24h || []).filter(e => e.event_name === "page_view").length;
        const postOpens24h = (events24h || []).filter(e => e.event_name === "post_open").length;
        const watchOpens24h = (events24h || []).filter(e => e.event_name === "watch_open").length;

        // Top screens (from page_view)
        const screenMap = new Map<string, number>();
        for (const e of events24h || []) {
          if (e.event_name !== "page_view") continue;
          const key = e.screen || "unknown";
          screenMap.set(key, (screenMap.get(key) || 0) + 1);
        }
        const topScreens = Array.from(screenMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([screen, count]) => ({ screen, count }));

        // Top events
        const eventMap = new Map<string, number>();
        for (const e of events24h || []) {
          const key = e.event_name || "unknown";
          eventMap.set(key, (eventMap.get(key) || 0) + 1);
        }
        const topEvents = Array.from(eventMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([event_name, count]) => ({ event_name, count }));

        setStats({
          totalUsers: totalUsersRes.count || 0,
          activeUsers: activeUsersRes.count || 0,
          totalPosts: totalPostsRes.count || 0,
          pendingFlags: pendingFlagsRes.count || 0,
          activeSOS: activeSOSRes.count || 0,

          dau,
          wau,
          mau,
          avgSessionMin,

          pageViews24h,
          postOpens24h,
          watchOpens24h,
        });

        setTopScreens(topScreens);
        setTopEvents(topEvents);
      } catch (e) {
        console.error("Analytics load error:", e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const cards: MetricCard[] = useMemo(() => [
    { label: "Total Users", value: stats.totalUsers, icon: Users },
    { label: "Active Users", value: stats.activeUsers, icon: TrendingUp },
    { label: "Total Posts", value: stats.totalPosts, icon: BarChart3 },
    { label: "Pending Flags", value: stats.pendingFlags, icon: MousePointerClick },
    { label: "Active SOS", value: stats.activeSOS, icon: MousePointerClick },

    { label: "DAU (24h)", value: stats.dau, icon: Users, hint: "Distinct users with sessions in last 24h" },
    { label: "WAU (7d)", value: stats.wau, icon: Users },
    { label: "MAU (30d)", value: stats.mau, icon: Users },
    { label: "Avg Session (min)", value: stats.avgSessionMin, icon: Clock },

    { label: "Page Views (24h)", value: stats.pageViews24h, icon: BarChart3 },
    { label: "Post Opens (24h)", value: stats.postOpens24h, icon: BarChart3 },
    { label: "Watch Opens (24h)", value: stats.watchOpens24h, icon: BarChart3 },
  ], [stats]);

 if (loading) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="glass-card">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="h-6 w-16 mb-2" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card">
          <Skeleton className="h-5 w-44 mb-4" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>

        <div className="glass-card">
          <Skeleton className="h-5 w-40 mb-4" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-100">Analytics</h1>
        <p className="text-dark-400 mt-1">Engagement & retention overview (web)</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="glass-card">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary-600/10">
                  <Icon className="w-5 h-5 text-primary-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold text-dark-100">{c.value}</p>
                  <p className="text-sm text-dark-400 truncate">{c.label}</p>
                  {c.hint && <p className="text-xs text-dark-500 mt-1">{c.hint}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card">
          <h2 className="text-lg font-semibold text-dark-100 mb-4">Top Screens (24h)</h2>
          {topScreens.length === 0 ? (
            <p className="text-dark-400">No data yet</p>
          ) : (
            <div className="space-y-2">
              {topScreens.map((x) => (
                <div key={x.screen} className="flex items-center justify-between text-sm">
                  <span className="text-dark-200 truncate">{x.screen}</span>
                  <span className="text-dark-400">{x.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card">
          <h2 className="text-lg font-semibold text-dark-100 mb-4">Top Events (24h)</h2>
          {topEvents.length === 0 ? (
            <p className="text-dark-400">No data yet</p>
          ) : (
            <div className="space-y-2">
              {topEvents.map((x) => (
                <div key={x.event_name} className="flex items-center justify-between text-sm">
                  <span className="text-dark-200 truncate">{x.event_name}</span>
                  <span className="text-dark-400">{x.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-dark-500 mt-6">
        Note: deeper retention/click funnels improve as we add more event types (confirm clicks, search submits, share, etc.).
      </p>
    </div>
  );
}