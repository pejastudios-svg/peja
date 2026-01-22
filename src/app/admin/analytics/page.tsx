"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, TrendingUp, Users, Clock, MousePointerClick, BarChart3 } from "lucide-react";
import { subDays } from "date-fns";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import PejaChartCard from "@/components/charts/PejaChartCard";
import PejaMetricTile from "@/components/charts/PejaMetricTile";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, ResponsiveContainer } from "recharts";
import HudShell from "@/components/dashboard/HudShell";
import GlowButton from "@/components/dashboard/GlowButton";

type MetricCard = { label: string; value: string | number; icon: any; hint?: string };

function AnalyticsTile({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string | number;
  icon: any;
  hint?: string;
}) {
  return (
    <div className="hud-panel p-5 relative overflow-hidden group hover:border-primary-500/30 transition-all">
      <div className="pointer-events-none absolute inset-0 opacity-20">
        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-primary-500/20 blur-3xl group-hover:bg-primary-500/30 transition-colors" />
      </div>

      <div className="flex items-center gap-4 relative z-10">
        <div className="p-3.5 rounded-2xl border border-primary-500/20 bg-primary-600/10 shadow-[0_0_15px_rgba(124,58,237,0.1)] text-primary-300 group-hover:scale-110 transition-transform duration-500">
          <Icon className="w-6 h-6" />
        </div>

        <div className="min-w-0">
          <p className="text-3xl font-bold text-white leading-none mb-1 tracking-tight">{value}</p>
          <p className="text-xs uppercase tracking-wider text-dark-400 font-bold">{label}</p>
        </div>
      </div>
      {hint && <p className="text-[10px] text-dark-500 mt-3 relative z-10 border-t border-white/5 pt-2">{hint}</p>}
    </div>
  );
}

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
  const [hourlyData, setHourlyData] = useState<{ hour: number; count: number }[]>(
  () => new Array(24).fill(0).map((_, i) => ({ hour: i, count: 0 }))
);

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

          // Build hourly series for chart
const hourly = new Array(24).fill(0).map((_, i) => ({ hour: i, count: 0 }));
for (const e of events24h || []) {
  const t = new Date((e as any).created_at || Date.now());
  const h = t.getHours();
  if (hourly[h]) hourly[h].count += 1;
}
setHourlyData(hourly);

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
    <HudShell
      title="System Analytics"
      subtitle="Deep dive metrics and platform engagement"
      right={
        <GlowButton onClick={() => window.location.reload()} className="h-9 text-xs">
          <Loader2 className="w-3 h-3 mr-2 inline" /> Refresh Data
        </GlowButton>
      }
    >
      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <AnalyticsTile
            key={c.label}
            label={c.label}
            value={c.value}
            icon={c.icon}
            hint={c.hint}
          />
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <PejaChartCard title="Events Activity (24h)" subtitle="System-wide interaction volume" height={300}>
          <div className="w-full h-full relative">
             <div className="absolute inset-0 bg-linear-to-t from-primary-900/10 to-transparent pointer-events-none" />
              <div className="w-full h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyData}>
                     <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
                     <XAxis dataKey="hour" stroke="rgba(255,255,255,0.2)" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                     <Tooltip 
                       contentStyle={{ background: '#13111C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} 
                       itemStyle={{ color: '#fff' }}
                       cursor={{ stroke: 'rgba(124,58,237,0.5)', strokeWidth: 1, strokeDasharray: '4 4' }}
                     />
                     <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#fff', stroke: '#8b5cf6', strokeWidth: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
          </div>
        </PejaChartCard>

        <PejaChartCard title="Content Engagement" subtitle="Posts vs Watch (24h)" height={300}>
          <div className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: "Posts", value: stats.postOpens24h }, { name: "Reels", value: stats.watchOpens24h }]}>
                 <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
                 <XAxis dataKey="name" stroke="rgba(255,255,255,0.2)" axisLine={false} tickLine={false} />
                 <Tooltip 
                    cursor={{fill: 'rgba(255,255,255,0.03)', radius: 8}} 
                    contentStyle={{ background: '#13111C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} 
                 />
                 <Bar dataKey="value" fill="url(#colorGradient)" radius={[6, 6, 0, 0]} barSize={60}>
                    <defs>
                        <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={1}/>
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.8}/>
                        </linearGradient>
                    </defs>
                 </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </PejaChartCard>
      </div>

      {/* Tables Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="hud-panel p-6">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-sm font-bold text-dark-100 uppercase tracking-widest">Top Screens</h3>
             <span className="text-[10px] text-dark-500 bg-white/5 px-2 py-1 rounded">24 HOURS</span>
          </div>
          <div className="space-y-2">
            {topScreens.map((s, i) => (
               <div key={s.screen} className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                  <span className="text-sm text-dark-200 font-medium flex items-center gap-3">
                      <span className={`text-xs font-bold w-6 h-6 rounded flex items-center justify-center ${i < 3 ? 'bg-primary-500/20 text-primary-300' : 'bg-dark-800 text-dark-500'}`}>#{i+1}</span>
                      {s.screen}
                  </span>
                  <span className="text-xs font-mono font-bold text-white">{s.count}</span>
               </div>
            ))}
          </div>
        </div>

        <div className="hud-panel p-6">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-sm font-bold text-dark-100 uppercase tracking-widest">Top Events</h3>
             <span className="text-[10px] text-dark-500 bg-white/5 px-2 py-1 rounded">24 HOURS</span>
          </div>
          <div className="space-y-2">
            {topEvents.map((e, i) => (
               <div key={e.event_name} className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                  <span className="text-sm text-dark-200 font-medium flex items-center gap-3">
                      <span className={`text-xs font-bold w-6 h-6 rounded flex items-center justify-center ${i < 3 ? 'bg-blue-500/20 text-blue-300' : 'bg-dark-800 text-dark-500'}`}>#{i+1}</span>
                      {e.event_name}
                  </span>
                  <span className="text-xs font-mono font-bold text-blue-300">{e.count}</span>
               </div>
            ))}
          </div>
        </div>
      </div>
    </HudShell>
  );
}