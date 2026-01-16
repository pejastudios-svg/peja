"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  AlertTriangle,
  BarChart3,
  Clock,
  Flag,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import { formatDistanceToNow, subDays } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type SeriesPoint = {
  day: string; // e.g. "Mon"
  posts: number;
  sos: number;
  flags: number;
};

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function CornerGlow() {
  return (
    <>
      <div className="pointer-events-none absolute -top-20 -left-20 w-44 h-44 rounded-full bg-primary-600/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-primary-600/20 blur-3xl" />
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary-500/35 to-transparent" />
    </>
  );
}

function KpiTile({
  label,
  value,
  icon,
  tone = "purple",
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "purple" | "red" | "orange" | "green" | "blue";
  sub?: string;
}) {
  const toneMap = {
    purple: "border-primary-500/25 bg-primary-600/10 text-primary-200",
    red: "border-red-500/25 bg-red-500/10 text-red-200",
    orange: "border-orange-500/25 bg-orange-500/10 text-orange-200",
    green: "border-green-500/25 bg-green-500/10 text-green-200",
    blue: "border-blue-500/25 bg-blue-500/10 text-blue-200",
  };

  return (
    <div className="hud-panel p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -top-16 -right-20 w-40 h-40 rounded-full bg-white/5 blur-2xl" />
      </div>

      <div className="flex items-center gap-3">
        <div className={`p-3 rounded-xl border ${toneMap[tone]} shadow-[0_0_18px_rgba(124,58,237,0.25)]`}>
          {icon}
        </div>

        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-dark-500">{label}</p>
          <p className="text-2xl font-bold text-dark-100 leading-tight">{value}</p>
          {sub && <p className="text-xs text-dark-500 mt-0.5">{sub}</p>}
        </div>

        <div className="ml-auto">
          <div className="pill pill-purple">Live</div>
        </div>
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalPosts: 0,
    livePosts: 0,
    activeSOS: 0,
    flaggedContent: 0,
    totalGuardians: 0,
    pendingApplications: 0,
  });

  const [recentPosts, setRecentPosts] = useState<any[]>([]);
  const [activeSOS, setActiveSOS] = useState<any[]>([]);
  const [series, setSeries] = useState<SeriesPoint[]>([]);

  const fetchData = async () => {
    setLoading(true);

    try {
      const now = new Date();
      const start7 = subDays(now, 6);
      const startIso = start7.toISOString();

      // counts + lists
      const [
        { count: totalUsers },
        { count: activeUsersCount },
        { count: totalPosts },
        { count: livePosts },
        { count: activeSOSCount },
        { count: flaggedContent },
        { count: totalGuardians },
        { count: pendingApplications },
        { data: recentPostsData },
        { data: sosData },
      ] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }),
        supabase.from("users").select("*", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("posts").select("*", { count: "exact", head: true }),
        supabase.from("posts").select("*", { count: "exact", head: true }).eq("status", "live"),
        supabase.from("sos_alerts").select("*", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("flagged_content").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("users").select("*", { count: "exact", head: true }).eq("is_guardian", true),
        supabase.from("guardian_applications").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("posts").select("id,category,created_at,users:user_id(full_name)").order("created_at", { ascending: false }).limit(6),
        supabase.from("sos_alerts").select("id,address,created_at,users:user_id(full_name, avatar_url)").eq("status", "active").order("created_at", { ascending: false }).limit(6),
      ]);

      setStats({
        totalUsers: totalUsers || 0,
        activeUsers: activeUsersCount || 0,
        totalPosts: totalPosts || 0,
        livePosts: livePosts || 0,
        activeSOS: activeSOSCount || 0,
        flaggedContent: flaggedContent || 0,
        totalGuardians: totalGuardians || 0,
        pendingApplications: pendingApplications || 0,
      });

      setRecentPosts(recentPostsData || []);
      setActiveSOS(sosData || []);

      // 7-day series (posts/sos/flags)
      const [{ data: posts7 }, { data: sos7 }, { data: flags7 }] = await Promise.all([
        supabase.from("posts").select("created_at").gte("created_at", startIso).limit(5000),
        supabase.from("sos_alerts").select("created_at").gte("created_at", startIso).limit(5000),
        supabase.from("flagged_content").select("created_at").gte("created_at", startIso).limit(5000),
      ]);

      const buckets: Record<string, SeriesPoint> = {};
      for (let i = 0; i < 7; i++) {
        const d = subDays(now, 6 - i);
        const k = dayKey(d);
        buckets[k] = { day: dayLabel(d), posts: 0, sos: 0, flags: 0 };
      }

      (posts7 || []).forEach((r: any) => {
        const k = (r.created_at || "").slice(0, 10);
        if (buckets[k]) buckets[k].posts += 1;
      });

      (sos7 || []).forEach((r: any) => {
        const k = (r.created_at || "").slice(0, 10);
        if (buckets[k]) buckets[k].sos += 1;
      });

      (flags7 || []).forEach((r: any) => {
        const k = (r.created_at || "").slice(0, 10);
        if (buckets[k]) buckets[k].flags += 1;
      });

      setSeries(Object.values(buckets));
    } catch (e) {
      console.error("Admin overview fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const kpis = useMemo(
    () => [
      {
        label: "Active SOS",
        value: stats.activeSOS,
        tone: "red" as const,
        icon: <AlertTriangle className="w-5 h-5 text-red-300" />,
        sub: "Critical alerts live now",
      },
      {
        label: "Pending Flags",
        value: stats.flaggedContent,
        tone: "orange" as const,
        icon: <Flag className="w-5 h-5 text-orange-300" />,
        sub: "Needs review",
      },
      {
        label: "Users (Active)",
        value: stats.activeUsers,
        tone: "green" as const,
        icon: <Users className="w-5 h-5 text-green-300" />,
        sub: `Total: ${stats.totalUsers}`,
      },
      {
        label: "Posts (Live)",
        value: stats.livePosts,
        tone: "purple" as const,
        icon: <TrendingUp className="w-5 h-5 text-primary-200" />,
        sub: `Total: ${stats.totalPosts}`,
      },
      {
        label: "Guardians",
        value: stats.totalGuardians,
        tone: "blue" as const,
        icon: <Shield className="w-5 h-5 text-blue-300" />,
        sub: `Pending apps: ${stats.pendingApplications}`,
      },
    ],
    [stats]
  );

  if (loading) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <Skeleton className="h-8 w-60 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="hud-panel p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-24 mb-2" />
                  <Skeleton className="h-6 w-16 mb-2" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-4 mt-4">
          <div className="hud-panel p-4 lg:col-span-2">
            <Skeleton className="h-5 w-40 mb-3" />
            <Skeleton className="h-56 w-full rounded-xl" />
          </div>
          <div className="hud-panel p-4">
            <Skeleton className="h-5 w-40 mb-3" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="py-2 flex items-center justify-between">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <HudShell
      title="Peja Admin - Ops Center"
      subtitle="Live safety signals, incident flow, and moderation pressure (NG)"
      right={
        <div className="flex items-center gap-2">
          <div className="pill pill-purple">Realtime</div>
          <GlowButton onClick={fetchData}>Refresh</GlowButton>
        </div>
      }
    >
      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} sub={k.sub} />
        ))}
      </div>

      {/* Main row */}
      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        {/* Hero chart */}
        <HudPanel
          className="relative overflow-hidden lg:col-span-2"
          title="Threat Activity (7 days)"
          subtitle="Posts vs SOS vs Flags - trend pressure"
          right={<div className="pill pill-purple">Signal</div>}
        >
          <CornerGlow />
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" stroke="rgba(255,255,255,0.35)" tick={{ fontSize: 12 }} />
                <YAxis stroke="rgba(255,255,255,0.35)" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(18,10,30,0.95)",
                    border: "1px solid rgba(139,92,246,0.25)",
                    borderRadius: 12,
                  }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Area type="monotone" dataKey="posts" stroke="#a78bfa" fill="rgba(124,58,237,0.20)" strokeWidth={2} />
                <Area type="monotone" dataKey="flags" stroke="#fb923c" fill="rgba(249,115,22,0.14)" strokeWidth={2} />
                <Area type="monotone" dataKey="sos" stroke="#f87171" fill="rgba(239,68,68,0.12)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className="pill pill-purple">Posts</span>
            <span className="pill" style={{ borderColor: "rgba(249,115,22,0.25)", color: "#fdba74", background: "rgba(249,115,22,0.10)" }}>
              Flags
            </span>
            <span className="pill pill-red">SOS</span>
          </div>
        </HudPanel>

        {/* Live SOS */}
        <HudPanel
          className="relative overflow-hidden"
          title="Active SOS"
          subtitle="Requires immediate attention"
          right={<span className="pill pill-red">{stats.activeSOS} live</span>}
        >
          <CornerGlow />
          {activeSOS.length === 0 ? (
            <p className="text-sm text-dark-400">No active SOS alerts</p>
          ) : (
            <div className="space-y-2">
              {activeSOS.map((sos) => (
                <div
                  key={sos.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20"
                >
                  <div className="w-10 h-10 rounded-full overflow-hidden border border-red-500/40 bg-red-500/10 shrink-0 flex items-center justify-center">
                    {sos.users?.avatar_url ? (
                      <img src={sos.users.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-300" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-dark-100 truncate">
                      {sos.users?.full_name || "Unknown user"}
                    </p>
                    <p className="text-xs text-dark-400 truncate">{sos.address || "No address"}</p>
                  </div>

                  <span className="text-[11px] text-dark-500 flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(sos.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </HudPanel>
      </div>

      {/* Second row */}
      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <HudPanel
          className="relative overflow-hidden"
          title="Recent Incidents"
          subtitle="Latest posts entering the system"
          right={<span className="pill pill-purple">Feed</span>}
        >
          <CornerGlow />
          {recentPosts.length === 0 ? (
            <p className="text-sm text-dark-400">No posts yet</p>
          ) : (
            <div className="space-y-2">
              {recentPosts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-dark-100 font-medium truncate">
                      {String(p.category || "").replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-dark-500 truncate">
                      by {p.users?.full_name || "Anonymous"}
                    </p>
                  </div>

                  <span className="text-[11px] text-dark-500 shrink-0">
                    {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </HudPanel>

        <HudPanel
          className="relative overflow-hidden"
          title="System Pressure"
          subtitle="Moderation + response posture"
          right={<span className="pill pill-purple">Status</span>}
        >
          <CornerGlow />

          <div className="grid grid-cols-2 gap-3">
            <div className="hud-panel p-4">
              <p className="text-xs text-dark-500 uppercase tracking-wide">Pending Flags</p>
              <p className="text-2xl font-bold text-dark-100 mt-1">{stats.flaggedContent}</p>
              <p className="text-xs text-dark-500 mt-1">Queue load</p>
            </div>

            <div className="hud-panel p-4">
              <p className="text-xs text-dark-500 uppercase tracking-wide">Pending Apps</p>
              <p className="text-2xl font-bold text-dark-100 mt-1">{stats.pendingApplications}</p>
              <p className="text-xs text-dark-500 mt-1">Guardian intake</p>
            </div>

            <div className="hud-panel p-4">
              <p className="text-xs text-dark-500 uppercase tracking-wide">Guardians</p>
              <p className="text-2xl font-bold text-dark-100 mt-1">{stats.totalGuardians}</p>
              <p className="text-xs text-dark-500 mt-1">Active moderators</p>
            </div>

            <div className="hud-panel p-4">
              <p className="text-xs text-dark-500 uppercase tracking-wide">Users</p>
              <p className="text-2xl font-bold text-dark-100 mt-1">{stats.activeUsers}</p>
              <p className="text-xs text-dark-500 mt-1">Active accounts</p>
            </div>
          </div>

          <div className="mt-4 p-3 rounded-xl bg-primary-600/10 border border-primary-500/20 text-xs text-dark-300 flex items-start gap-2">
            <BarChart3 className="w-4 h-4 text-primary-300 mt-0.5" />
            <div>
              <p className="text-dark-100 font-semibold">Tip</p>
              <p className="text-dark-400 mt-0.5">
                If flagged content rises rapidly, assign more Guardians.
              </p>
            </div>
          </div>
        </HudPanel>
      </div>
    </HudShell>
  );
}