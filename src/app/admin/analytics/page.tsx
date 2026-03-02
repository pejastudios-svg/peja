"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { CATEGORIES, SOS_TAGS } from "@/lib/types";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";
import type { MapHelper } from "@/components/admin/AdminLiveMap";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Loader2,
  Users,
  Clock,
  MousePointerClick,
  BarChart3,
  AlertTriangle,
  Flag,
  Shield,
  Radio,
  Activity,
  Zap,
  Map as MapIcon,
  Eye,
  UserPlus,
  ChevronDown,
  MapPin,
  Navigation,
  CheckCircle2,
} from "lucide-react";
import { subDays, formatDistanceToNow } from "date-fns";

/* ── dynamic map (no SSR) ── */
const AdminLiveMap = dynamic(() => import("@/components/admin/AdminLiveMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-dark-900 rounded-xl">
      <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
    </div>
  ),
});

/* ═══════════════ TYPES ═══════════════ */
type StreamPoint = {
  time: string;
  posts: number;
  sos: number;
  flags: number;
  total: number;
};
type LiveEvent = {
  id: string;
  type: "post" | "sos" | "flag" | "user";
  message: string;
  timestamp: Date;
  color: string;
};
type Hotspot = {
  area: string;
  count: number;
  topCategory: string;
  topCategoryName: string;
  topCategoryColor: string;
  peakTime: string;
  lat: number;
  lng: number;
};
type SOSDispatch = {
  id: string;
  userName: string;
  userAvatar: string | null;
  address: string;
  tag: string | null;
  created_at: string;
  latitude: number;
  longitude: number;
  helpers: {
    id: string;
    name: string;
    avatar_url: string | null;
    eta: number;
    milestone: string | null;
    lastUpdate: string;
  }[];
};

/* ═══════════════ HELPERS ═══════════════ */
function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function timeLabel(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}
function dayLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
function makeStreamSeed(minutes: number): StreamPoint[] {
  const now = new Date();
  return Array.from({ length: minutes }, (_, i) => {
    const t = new Date(now.getTime() - (minutes - 1 - i) * 60000);
    return { time: timeLabel(t), posts: 0, sos: 0, flags: 0, total: 0 };
  });
}
function distinct(rows: any[]) {
  return new Set((rows || []).map((r) => r.user_id).filter(Boolean)).size;
}
function getTimeSlot(dateStr: string): string {
  const h = new Date(dateStr).getHours();
  if (h < 6) return "Night";
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}
function milestoneLabel(m: string | null): {
  text: string;
  color: string;
} {
  if (!m) return { text: "En route", color: "text-blue-400" };
  if (m === "arrived") return { text: "Arrived ✓", color: "text-green-400" };
  if (m.endsWith("min")) {
    const n = parseInt(m);
    if (n <= 2) return { text: "Almost there!", color: "text-green-400" };
    if (n <= 5) return { text: "Very close", color: "text-yellow-400" };
    return { text: `~${n} min`, color: "text-blue-400" };
  }
  return { text: "En route", color: "text-blue-400" };
}

/* ═══════════════ SUB-COMPONENTS ═══════════════ */

function KpiTile({
  label,
  value,
  icon: Icon,
  tone = "purple",
  flash = false,
  sub,
}: {
  label: string;
  value: string | number;
  icon: any;
  tone?: string;
  flash?: boolean;
  sub?: string;
}) {
  const toneMap: Record<string, string> = {
    purple: "border-primary-500/25 bg-primary-600/10 text-primary-200",
    red: "border-red-500/25 bg-red-500/10 text-red-200",
    orange: "border-orange-500/25 bg-orange-500/10 text-orange-200",
    green: "border-green-500/25 bg-green-500/10 text-green-200",
    blue: "border-blue-500/25 bg-blue-500/10 text-blue-200",
  };
  return (
    <div
      className={`hud-panel p-4 relative overflow-hidden transition-all duration-300 ${
        flash ? "ring-2 ring-primary-400/60 scale-[1.02]" : ""
      }`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-primary-500/15 blur-3xl" />
      </div>
      <div className="flex items-center gap-3 relative z-10">
        <div
          className={`p-3 rounded-xl border ${
            toneMap[tone] || toneMap.purple
          } shadow-[0_0_12px_rgba(124,58,237,0.15)]`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-white leading-none mb-0.5 tracking-tight">
            {value}
          </p>
          <p className="text-[11px] uppercase tracking-wider text-dark-400 font-semibold">
            {label}
          </p>
          {sub && (
            <p className="text-[10px] text-dark-500 mt-0.5">{sub}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveEventItem({ event }: { event: LiveEvent }) {
  const iconMap: Record<string, any> = {
    post: Zap,
    sos: AlertTriangle,
    flag: Flag,
    user: UserPlus,
  };
  const Icon = iconMap[event.type] || Zap;
  return (
    <div className="flex items-start gap-3 p-2.5 rounded-lg bg-white/5 border border-white/5 animate-in fade-in slide-in-from-top-2 duration-200">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{
          background: `${event.color}20`,
          border: `1px solid ${event.color}40`,
        }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: event.color }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-dark-200 leading-snug">{event.message}</p>
        <p className="text-[10px] text-dark-500 mt-0.5">
          {formatDistanceToNow(event.timestamp, { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="hud-panel overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-dark-100 uppercase tracking-widest">
            {title}
          </h3>
          {badge && (
            <span className="text-[10px] text-dark-500 bg-white/5 px-2 py-0.5 rounded">
              {badge}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-dark-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="px-5 pb-5 space-y-2">{children}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════ */
export default function AdminAnalyticsPage() {
  useScrollRestore("admin:analytics");

  const [loading, setLoading] = useState(true);
  const [flashFields, setFlashFields] = useState<Record<string, boolean>>({});

  /* ── core stats ── */
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalPosts: 0,
    livePosts: 0,
    pendingFlags: 0,
    activeSOS: 0,
    totalGuardians: 0,
    pendingApps: 0,
    dau: 0,
    wau: 0,
    mau: 0,
    avgSessionMin: 0,
    pageViews24h: 0,
    postOpens24h: 0,
    watchOpens24h: 0,
  });

  /* ── chart state ── */
  const [streamData, setStreamData] = useState<StreamPoint[]>(() =>
    makeStreamSeed(60)
  );
  const [seriesData, setSeriesData] = useState<
    { day: string; posts: number; sos: number; flags: number }[]
  >([]);
  const [hourlyData, setHourlyData] = useState<{ hour: number; count: number }[]>(
    () => Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }))
  );
  const [categoryData, setCategoryData] = useState<
    { name: string; count: number; color: string }[]
  >([]);

  /* ── tables ── */
  const [topScreens, setTopScreens] = useState<
    { screen: string; count: number }[]
  >([]);
  const [topEvents, setTopEvents] = useState<
    { event_name: string; count: number }[]
  >([]);

  /* ── hotspots ── */
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);

  /* ── live feed ── */
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);

  /* ── helper dispatch ── */
  const [mapHelpers, setMapHelpers] = useState<MapHelper[]>([]);
  const [dispatches, setDispatches] = useState<SOSDispatch[]>([]);
  const helperPollRef = useRef<NodeJS.Timeout | null>(null);

  /* ── refs ── */
  const channelsRef = useRef<any[]>([]);
  const shiftRef = useRef<NodeJS.Timeout | null>(null);

  /* ── utilities ── */
  const flash = useCallback((key: string) => {
    setFlashFields((p) => ({ ...p, [key]: true }));
    setTimeout(() => setFlashFields((p) => ({ ...p, [key]: false })), 1200);
  }, []);

  const addLiveEvent = useCallback(
    (type: LiveEvent["type"], message: string) => {
      const colors: Record<string, string> = {
        post: "#8b5cf6",
        sos: "#ef4444",
        flag: "#f97316",
        user: "#22c55e",
      };
      setLiveEvents((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random()}`,
            type,
            message,
            timestamp: new Date(),
            color: colors[type] || "#8b5cf6",
          },
          ...prev,
        ].slice(0, 50)
      );
    },
    []
  );

  /* ══════════════════════════════════════════════
     FETCH HELPERS VIA API (polls every 15s)
     ══════════════════════════════════════════════ */
  const fetchHelpers = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

const res = await fetch("/api/sos-helpers", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;

      const json = await res.json();
      const helpers: MapHelper[] = (json.helpers || []).map((h: any) => ({
        id: h.id,
        name: h.name,
        avatar_url: h.avatar_url,
        lat: h.lat,
        lng: h.lng,
        eta: h.eta,
        sosId: h.sosId,
        milestone: h.milestone,
      }));
      setMapHelpers(helpers);

      /* build dispatch board */
      const sosAlerts: any[] = json.sosAlerts || [];
      const dispatchList: SOSDispatch[] = sosAlerts.map((s: any) => {
        const sosHelpers = (json.helpers || [])
          .filter((h: any) => h.sosId === s.id)
          .map((h: any) => ({
            id: h.id,
            name: h.name,
            avatar_url: h.avatar_url,
            eta: h.eta,
            milestone: h.milestone,
            lastUpdate: h.lastUpdate,
          }));

        return {
          id: s.id,
          userName: s.userName,
          userAvatar: s.userAvatar,
          address: s.address || "Unknown",
          tag: s.tag,
          created_at: s.created_at,
          latitude: s.latitude,
          longitude: s.longitude,
          helpers: sosHelpers,
        };
      });
      setDispatches(dispatchList);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchHelpers();
    helperPollRef.current = setInterval(fetchHelpers, 15000);
    return () => {
      if (helperPollRef.current) clearInterval(helperPollRef.current);
    };
  }, [fetchHelpers]);

  /* ══════════════════════════════════════════════
     INITIAL DATA FETCH
     ══════════════════════════════════════════════ */
  useEffect(() => {
    (async () => {
      setLoading(true);
      const now = new Date();
      const d1 = subDays(now, 1).toISOString();
      const d7 = subDays(now, 7).toISOString();
      const d30 = subDays(now, 30).toISOString();
      const d60min = new Date(now.getTime() - 60 * 60000).toISOString();

      try {
        /* ── counts ── */
        const [
          { count: totalUsers },
          { count: activeUsers },
          { count: totalPosts },
          { count: livePosts },
          { count: activeSOS },
          { count: pendingFlags },
          { count: totalGuardians },
          { count: pendingApps },
        ] = await Promise.all([
          supabase.from("users").select("*", { count: "exact", head: true }),
          supabase
            .from("users")
            .select("*", { count: "exact", head: true })
            .eq("status", "active"),
          supabase.from("posts").select("*", { count: "exact", head: true }),
          supabase
            .from("posts")
            .select("*", { count: "exact", head: true })
            .eq("status", "live"),
          supabase
            .from("sos_alerts")
            .select("*", { count: "exact", head: true })
            .eq("status", "active"),
          supabase
            .from("flagged_content")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending"),
          supabase
            .from("users")
            .select("*", { count: "exact", head: true })
            .eq("is_guardian", true),
          supabase
            .from("guardian_applications")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending"),
        ]);

        /* ── sessions ── */
        const [{ data: dauR }, { data: wauR }, { data: mauR }] =
          await Promise.all([
            supabase
              .from("user_sessions")
              .select("user_id")
              .gte("last_seen_at", d1),
            supabase
              .from("user_sessions")
              .select("user_id")
              .gte("last_seen_at", d7),
            supabase
              .from("user_sessions")
              .select("user_id")
              .gte("last_seen_at", d30),
          ]);
        const dau = distinct(dauR || []);
        const wau = distinct(wauR || []);
        const mau = distinct(mauR || []);

        const { data: sess24 } = await supabase
          .from("user_sessions")
          .select("started_at,last_seen_at")
          .gte("last_seen_at", d1)
          .limit(5000);
        let avgSessionMin = 0;
        if (sess24?.length) {
          let sum = 0,
            n = 0;
          for (const s of sess24) {
            const a = new Date(s.started_at).getTime();
            const b = new Date(s.last_seen_at).getTime();
            if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
              sum += Math.min((b - a) / 60000, 240);
              n++;
            }
          }
          avgSessionMin = n ? Math.round((sum / n) * 10) / 10 : 0;
        }

        /* ── events ── */
        const { data: ev24 } = await supabase
          .from("app_events")
          .select("event_name,screen,created_at")
          .gte("created_at", d1)
          .limit(10000);

        const pageViews24h = (ev24 || []).filter(
          (e) => e.event_name === "page_view"
        ).length;
        const postOpens24h = (ev24 || []).filter(
          (e) => e.event_name === "post_open"
        ).length;
        const watchOpens24h = (ev24 || []).filter(
          (e) => e.event_name === "watch_open"
        ).length;

        /* hourly */
        const hourly = Array.from({ length: 24 }, (_, i) => ({
          hour: i,
          count: 0,
        }));
        for (const e of ev24 || []) {
          const h = new Date((e as any).created_at).getHours();
          if (hourly[h]) hourly[h].count++;
        }
        setHourlyData(hourly);

        /* top screens */
        const sMap = new Map<string, number>();
        for (const e of ev24 || []) {
          if (e.event_name !== "page_view") continue;
          const k = e.screen || "unknown";
          sMap.set(k, (sMap.get(k) || 0) + 1);
        }
        setTopScreens(
          [...sMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([screen, count]) => ({ screen, count }))
        );

        /* top events */
        const eMap = new Map<string, number>();
        for (const e of ev24 || []) {
          const k = e.event_name || "unknown";
          eMap.set(k, (eMap.get(k) || 0) + 1);
        }
        setTopEvents(
          [...eMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([event_name, count]) => ({ event_name, count }))
        );

        /* ── 7-day series ── */
        const start7 = subDays(now, 6).toISOString();
        const [{ data: p7 }, { data: s7 }, { data: f7 }] = await Promise.all([
          supabase
            .from("posts")
            .select("created_at")
            .gte("created_at", start7)
            .limit(5000),
          supabase
            .from("sos_alerts")
            .select("created_at")
            .gte("created_at", start7)
            .limit(5000),
          supabase
            .from("flagged_content")
            .select("created_at")
            .gte("created_at", start7)
            .limit(5000),
        ]);
        const buckets: Record<
          string,
          { day: string; posts: number; sos: number; flags: number }
        > = {};
        for (let i = 0; i < 7; i++) {
          const d = subDays(now, 6 - i);
          buckets[dayKey(d)] = { day: dayLabel(d), posts: 0, sos: 0, flags: 0 };
        }
        (p7 || []).forEach((r: any) => {
          const k = (r.created_at || "").slice(0, 10);
          if (buckets[k]) buckets[k].posts++;
        });
        (s7 || []).forEach((r: any) => {
          const k = (r.created_at || "").slice(0, 10);
          if (buckets[k]) buckets[k].sos++;
        });
        (f7 || []).forEach((r: any) => {
          const k = (r.created_at || "").slice(0, 10);
          if (buckets[k]) buckets[k].flags++;
        });
        setSeriesData(Object.values(buckets));

        /* ── stream seed ── */
        const seed = makeStreamSeed(60);
        const [{ data: p60 }, { data: s60 }, { data: f60 }] =
          await Promise.all([
            supabase
              .from("posts")
              .select("created_at")
              .gte("created_at", d60min)
              .limit(5000),
            supabase
              .from("sos_alerts")
              .select("created_at")
              .gte("created_at", d60min)
              .limit(5000),
            supabase
              .from("flagged_content")
              .select("created_at")
              .gte("created_at", d60min)
              .limit(5000),
          ]);
        const mMap = new Map<string, number>();
        seed.forEach((pt, i) => mMap.set(pt.time, i));
        const bump = (rows: any[], field: "posts" | "sos" | "flags") => {
          (rows || []).forEach((r: any) => {
            const idx = mMap.get(timeLabel(new Date(r.created_at)));
            if (idx !== undefined) {
              seed[idx][field]++;
              seed[idx].total++;
            }
          });
        };
        bump(p60 || [], "posts");
        bump(s60 || [], "sos");
        bump(f60 || [], "flags");
        setStreamData(seed);

        /* ── categories ── */
        const { data: catPosts } = await supabase
          .from("posts")
          .select("category")
          .limit(10000);
        const cMap = new Map<string, number>();
        (catPosts || []).forEach((p: any) =>
          cMap.set(p.category, (cMap.get(p.category) || 0) + 1)
        );
        setCategoryData(
          CATEGORIES.map((c) => ({
            name: c.name,
            count: cMap.get(c.id) || 0,
            color:
              c.color === "danger"
                ? "#ef4444"
                : c.color === "warning"
                ? "#f97316"
                : c.color === "awareness"
                ? "#eab308"
                : "#3b82f6",
          }))
            .filter((c) => c.count > 0)
            .sort((a, b) => b.count - a.count)
        );

        /* ── hotspots ── */
        const { data: locPosts } = await supabase
          .from("posts")
          .select("id, category, address, latitude, longitude, created_at")
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .not("address", "is", null)
          .order("created_at", { ascending: false })
          .limit(2000);

        const areaMap: Record<
          string,
          {
            count: number;
            cats: Record<string, number>;
            times: Record<string, number>;
            latSum: number;
            lngSum: number;
          }
        > = {};
        for (const p of locPosts || []) {
          const parts = (p.address || "").split(",").slice(0, 2);
          const area = parts.map((s: string) => s.trim()).join(", ");
          if (!area) continue;
          if (!areaMap[area])
            areaMap[area] = {
              count: 0,
              cats: {},
              times: {},
              latSum: 0,
              lngSum: 0,
            };
          areaMap[area].count++;
          areaMap[area].cats[p.category] =
            (areaMap[area].cats[p.category] || 0) + 1;
          const ts = getTimeSlot(p.created_at);
          areaMap[area].times[ts] = (areaMap[area].times[ts] || 0) + 1;
          areaMap[area].latSum += p.latitude;
          areaMap[area].lngSum += p.longitude;
        }
        const hotspotList: Hotspot[] = Object.entries(areaMap)
          .map(([area, d]) => {
            const topCatId =
              Object.entries(d.cats).sort((a, b) => b[1] - a[1])[0]?.[0] ||
              "general";
            const topCat = CATEGORIES.find((c) => c.id === topCatId);
            const peakTime =
              Object.entries(d.times).sort((a, b) => b[1] - a[1])[0]?.[0] ||
              "N/A";
            return {
              area,
              count: d.count,
              topCategory: topCatId,
              topCategoryName: topCat?.name || topCatId,
              topCategoryColor:
                topCat?.color === "danger"
                  ? "#ef4444"
                  : topCat?.color === "warning"
                  ? "#f97316"
                  : topCat?.color === "awareness"
                  ? "#eab308"
                  : "#3b82f6",
              peakTime,
              lat: d.latSum / d.count,
              lng: d.lngSum / d.count,
            };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 15);
        setHotspots(hotspotList);

        setStats({
          totalUsers: totalUsers || 0,
          activeUsers: activeUsers || 0,
          totalPosts: totalPosts || 0,
          livePosts: livePosts || 0,
          pendingFlags: pendingFlags || 0,
          activeSOS: activeSOS || 0,
          totalGuardians: totalGuardians || 0,
          pendingApps: pendingApps || 0,
          dau,
          wau,
          mau,
          avgSessionMin,
          pageViews24h,
          postOpens24h,
          watchOpens24h,
        });
      } catch {
        /* silent */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ══════════════════════════════════════════════
     REAL-TIME SUBSCRIPTIONS
     ══════════════════════════════════════════════ */
  useEffect(() => {
    if (loading) return;

    const postsCh = supabase
      .channel("ax-rt-posts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const p = payload.new as any;
          setStats((s) => ({
            ...s,
            totalPosts: s.totalPosts + 1,
            livePosts: s.livePosts + 1,
          }));
          flash("posts");
          setStreamData((prev) => {
            const next = [...prev];
            const last = { ...next[next.length - 1] };
            last.posts++;
            last.total++;
            next[next.length - 1] = last;
            return next;
          });
          const cat = CATEGORIES.find((c) => c.id === p.category);
          if (cat) {
            setCategoryData((prev) => {
              const idx = prev.findIndex((c) => c.name === cat.name);
              if (idx !== -1) {
                const next = [...prev];
                next[idx] = { ...next[idx], count: next[idx].count + 1 };
                return next.sort((a, b) => b.count - a.count);
              }
              return [
                ...prev,
                {
                  name: cat.name,
                  count: 1,
                  color:
                    cat.color === "danger"
                      ? "#ef4444"
                      : cat.color === "warning"
                      ? "#f97316"
                      : cat.color === "awareness"
                      ? "#eab308"
                      : "#3b82f6",
                },
              ].sort((a, b) => b.count - a.count);
            });
          }
          addLiveEvent("post", `New post: ${cat?.name || p.category}`);
        }
      )
      .subscribe();

    const sosCh = supabase
      .channel("ax-rt-sos")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sos_alerts" },
        () => {
          setStats((s) => ({ ...s, activeSOS: s.activeSOS + 1 }));
          flash("sos");
          setStreamData((prev) => {
            const next = [...prev];
            const last = { ...next[next.length - 1] };
            last.sos++;
            last.total++;
            next[next.length - 1] = last;
            return next;
          });
          addLiveEvent("sos", "🚨 SOS alert activated");
          fetchHelpers();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sos_alerts" },
        (payload) => {
          const s = payload.new as any;
          if (s.status !== "active") {
            setStats((st) => ({
              ...st,
              activeSOS: Math.max(0, st.activeSOS - 1),
            }));
            addLiveEvent(
              "sos",
              `SOS ${s.status === "resolved" ? "resolved ✓" : "cancelled"}`
            );
            fetchHelpers();
          }
        }
      )
      .subscribe();

    const flagsCh = supabase
      .channel("ax-rt-flags")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "flagged_content" },
        () => {
          setStats((s) => ({ ...s, pendingFlags: s.pendingFlags + 1 }));
          flash("flags");
          setStreamData((prev) => {
            const next = [...prev];
            const last = { ...next[next.length - 1] };
            last.flags++;
            last.total++;
            next[next.length - 1] = last;
            return next;
          });
          addLiveEvent("flag", "Content flagged for review");
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "flagged_content" },
        (payload) => {
          const f = payload.new as any;
          if (f.status !== "pending")
            setStats((s) => ({
              ...s,
              pendingFlags: Math.max(0, s.pendingFlags - 1),
            }));
        }
      )
      .subscribe();

    const usersCh = supabase
      .channel("ax-rt-users")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "users" },
        () => {
          setStats((s) => ({
            ...s,
            totalUsers: s.totalUsers + 1,
            activeUsers: s.activeUsers + 1,
          }));
          flash("users");
          addLiveEvent("user", "New user registered");
        }
      )
      .subscribe();

    channelsRef.current = [postsCh, sosCh, flagsCh, usersCh];

    shiftRef.current = setInterval(() => {
      setStreamData((prev) => [
        ...prev.slice(1),
        { time: timeLabel(new Date()), posts: 0, sos: 0, flags: 0, total: 0 },
      ]);
    }, 60000);

    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
      if (shiftRef.current) clearInterval(shiftRef.current);
    };
  }, [loading, flash, addLiveEvent, fetchHelpers]);

  /* ══════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════ */

  if (loading) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <Skeleton className="h-8 w-52 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="hud-panel p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div>
                  <Skeleton className="h-6 w-14 mb-1.5" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          <div className="hud-panel p-4">
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
          <div className="hud-panel p-4">
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const totalHelpers = dispatches.reduce(
    (sum, d) => sum + d.helpers.length,
    0
  );

  return (
    <HudShell
      title="System Analytics"
      subtitle="Real-time platform intelligence and live monitoring"
      right={
        <div className="flex items-center gap-2">
          <div className="pill pill-green flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            Live
          </div>
          <GlowButton
            onClick={() => window.location.reload()}
            className="h-9 text-xs"
          >
            <Loader2 className="w-3 h-3 mr-1.5 inline" /> Refresh
          </GlowButton>
        </div>
      }
    >
      {/* ═══════════ LIVE KPI STRIP ═══════════ */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
        <KpiTile
          label="Active SOS"
          value={stats.activeSOS}
          icon={AlertTriangle}
          tone="red"
          flash={flashFields.sos}
          sub="Live alerts"
        />
        <KpiTile
          label="Pending Flags"
          value={stats.pendingFlags}
          icon={Flag}
          tone="orange"
          flash={flashFields.flags}
          sub="Needs review"
        />
        <KpiTile
          label="Total Users"
          value={stats.totalUsers.toLocaleString()}
          icon={Users}
          tone="green"
          flash={flashFields.users}
          sub={`${stats.activeUsers} active`}
        />
        <KpiTile
          label="Total Posts"
          value={stats.totalPosts.toLocaleString()}
          icon={BarChart3}
          tone="purple"
          flash={flashFields.posts}
          sub={`${stats.livePosts} live`}
        />
        <KpiTile
          label="Guardians"
          value={stats.totalGuardians}
          icon={Shield}
          tone="blue"
          sub={`${stats.pendingApps} pending apps`}
        />
      </div>

      {/* ═══════════ STREAMING CHART + MAP ═══════════ */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <HudPanel
          className="relative overflow-hidden"
          title="Real-Time Activity"
          subtitle="Live event stream - last 60 minutes"
          right={
            <div className="pill pill-green flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              Streaming
            </div>
          }
        >
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={streamData}>
                <defs>
                  <linearGradient id="sPurple" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="sRed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="sOrange" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="rgba(255,255,255,0.04)"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  stroke="rgba(255,255,255,0.15)"
                  tick={{ fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  interval={9}
                />
                <YAxis
                  stroke="rgba(255,255,255,0.15)"
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#13111C",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                  }}
                  cursor={{
                    stroke: "rgba(124,58,237,0.4)",
                    strokeWidth: 1,
                    strokeDasharray: "4 4",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="posts"
                  stroke="#8b5cf6"
                  fill="url(#sPurple)"
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={400}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "#fff",
                    stroke: "#8b5cf6",
                    strokeWidth: 2,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="sos"
                  stroke="#ef4444"
                  fill="url(#sRed)"
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={400}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "#fff",
                    stroke: "#ef4444",
                    strokeWidth: 2,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="flags"
                  stroke="#f97316"
                  fill="url(#sOrange)"
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={400}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "#fff",
                    stroke: "#f97316",
                    strokeWidth: 2,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="pill pill-purple">Posts</span>
            <span className="pill pill-red">SOS</span>
            <span
              className="pill"
              style={{
                borderColor: "rgba(249,115,22,0.25)",
                color: "#fdba74",
                background: "rgba(249,115,22,0.10)",
              }}
            >
              Flags
            </span>
          </div>
        </HudPanel>

        <HudPanel
          className="relative overflow-hidden"
          title="Live Incident Map"
          subtitle="Incidents, SOS, helpers & hotspot heatmap"
          right={
            <div className="pill pill-red flex items-center gap-1.5">
              <MapIcon className="w-3 h-3" />
              Live
            </div>
          }
        >
          <div className="h-[320px] -mx-4 -mb-4 rounded-b-2xl overflow-hidden">
            <AdminLiveMap helpers={mapHelpers} />
          </div>
        </HudPanel>
      </div>

      {/* ═══════════ HELPER DISPATCH + LIVE FEED ═══════════ */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        {/* Dispatch board */}
        <HudPanel
          className="relative overflow-hidden lg:col-span-2"
          title="Helper Dispatch Board"
          subtitle={`${dispatches.length} active SOS • ${totalHelpers} helper${
            totalHelpers !== 1 ? "s" : ""
          } dispatched`}
          right={
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-dark-500">Refreshes every 15s</span>
              <div className="pill pill-green flex items-center gap-1.5">
                <Navigation className="w-3 h-3" />
                Track
              </div>
            </div>
          }
        >
          <div className="max-h-[340px] overflow-y-auto scrollbar-hide space-y-3">
            {dispatches.length === 0 ? (
              <div className="text-center py-8 text-dark-500">
                <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No active SOS alerts</p>
                <p className="text-xs mt-1">
                  Helper dispatch info will appear here when SOS is active
                </p>
              </div>
            ) : (
              dispatches.map((d) => {
                const tagInfo = d.tag
                  ? SOS_TAGS.find((t) => t.id === d.tag)
                  : null;
                return (
                  <div
                    key={d.id}
                    className="p-4 rounded-xl bg-red-500/5 border border-red-500/15"
                  >
                    {/* SOS owner header */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-red-500/50 shrink-0">
                        <img
                          src={
                            d.userAvatar ||
                            `https://ui-avatars.com/api/?name=${encodeURIComponent(
                              d.userName
                            )}&background=dc2626&color=fff`
                          }
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">
                          {d.userName}
                        </p>
                        <p className="text-xs text-dark-400 truncate flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {d.address}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {tagInfo && (
                          <span className="text-xs text-red-300 bg-red-500/10 px-2 py-0.5 rounded">
                            {tagInfo.icon} {tagInfo.label}
                          </span>
                        )}
                        <p className="text-[10px] text-dark-500 mt-1">
                          {formatDistanceToNow(new Date(d.created_at), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                    </div>

                    {/* Helpers list */}
                    {d.helpers.length === 0 ? (
                      <div className="p-2.5 rounded-lg bg-dark-800/50 text-center">
                        <p className="text-xs text-dark-500">
                          No helpers dispatched yet
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {d.helpers.map((h) => {
                          const ms = milestoneLabel(h.milestone);
                          return (
                            <div
                              key={h.id}
                              className="flex items-center gap-3 p-2.5 rounded-lg bg-green-500/5 border border-green-500/10"
                            >
                              <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-green-500/40 shrink-0">
                                <img
                                  src={
                                    h.avatar_url ||
                                    `https://ui-avatars.com/api/?name=${encodeURIComponent(
                                      h.name.charAt(0)
                                    )}&background=22c55e&color=fff`
                                  }
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-white truncate">
                                  {h.name}
                                </p>
                                <p className={`text-xs ${ms.color} flex items-center gap-1`}>
                                  {h.milestone === "arrived" ? (
                                    <CheckCircle2 className="w-3 h-3" />
                                  ) : (
                                    <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                                  )}
                                  {ms.text}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-lg font-bold text-green-400 leading-none">
                                  {h.milestone === "arrived"
                                    ? "✓"
                                    : `${h.eta}`}
                                </p>
                                {h.milestone !== "arrived" && (
                                  <p className="text-[10px] text-dark-500">
                                    min
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </HudPanel>

        {/* Live feed */}
        <HudPanel
          className="relative overflow-hidden"
          title="Live Activity"
          subtitle="Events as they happen"
          right={
            <div className="pill pill-green flex items-center gap-1.5">
              <Activity className="w-3 h-3" />
              Feed
            </div>
          }
        >
          <div className="h-[340px] overflow-y-auto scrollbar-hide space-y-2">
            {liveEvents.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-dark-500">
                <Radio className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">Listening for events…</p>
                <p className="text-xs mt-1">
                  Activity will appear here in real time
                </p>
              </div>
            ) : (
              liveEvents.map((ev) => (
                <LiveEventItem key={ev.id} event={ev} />
              ))
            )}
          </div>
        </HudPanel>
      </div>

      {/* ═══════════ 7-DAY TREND ═══════════ */}
      <HudPanel
        className="relative overflow-hidden mb-6"
        title="Threat Activity (7 Days)"
        subtitle="Posts vs SOS vs Flags - trend pressure"
        right={<div className="pill pill-purple">Signal</div>}
      >
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={seriesData}>
              <CartesianGrid
                stroke="rgba(255,255,255,0.05)"
                vertical={false}
              />
              <XAxis
                dataKey="day"
                stroke="rgba(255,255,255,0.25)"
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="rgba(255,255,255,0.25)"
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#13111C",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="posts"
                stroke="#a78bfa"
                fill="rgba(124,58,237,0.18)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="sos"
                stroke="#f87171"
                fill="rgba(239,68,68,0.12)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="flags"
                stroke="#fb923c"
                fill="rgba(249,115,22,0.12)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="pill pill-purple">Posts</span>
          <span className="pill pill-red">SOS</span>
          <span
            className="pill"
            style={{
              borderColor: "rgba(249,115,22,0.25)",
              color: "#fdba74",
              background: "rgba(249,115,22,0.10)",
            }}
          >
            Flags
          </span>
        </div>
      </HudPanel>

      {/* ═══════════ ENGAGEMENT + CATEGORIES ═══════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile
          label="DAU (24h)"
          value={stats.dau}
          icon={Users}
          tone="green"
          sub="Daily active"
        />
        <KpiTile
          label="WAU (7d)"
          value={stats.wau}
          icon={Users}
          tone="blue"
          sub="Weekly active"
        />
        <KpiTile
          label="MAU (30d)"
          value={stats.mau}
          icon={Users}
          tone="purple"
          sub="Monthly active"
        />
        <KpiTile
          label="Avg Session"
          value={`${stats.avgSessionMin}m`}
          icon={Clock}
          tone="orange"
          sub="Duration"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <HudPanel
          className="relative overflow-hidden"
          title="Post Categories"
          subtitle="All-time distribution"
        >
          <div className="h-[220px]">
            {categoryData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-dark-500 text-sm">
                No posts yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical">
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.04)"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    stroke="rgba(255,255,255,0.2)"
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="rgba(255,255,255,0.2)"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#13111C",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
                    {categoryData.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={entry.color}
                        fillOpacity={0.8}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </HudPanel>

        <HudPanel
          className="relative overflow-hidden"
          title="Hourly Events (24h)"
          subtitle="Interaction volume by hour"
        >
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData}>
                <CartesianGrid
                  stroke="rgba(255,255,255,0.04)"
                  vertical={false}
                />
                <XAxis
                  dataKey="hour"
                  stroke="rgba(255,255,255,0.2)"
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="rgba(255,255,255,0.2)"
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#13111C",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#8b5cf6"
                  fillOpacity={0.7}
                  radius={[4, 4, 0, 0]}
                  barSize={14}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </HudPanel>
      </div>

      {/* ═══════════ PAGE VIEWS STRIP ═══════════ */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <KpiTile
          label="Page Views (24h)"
          value={stats.pageViews24h.toLocaleString()}
          icon={Eye}
          tone="purple"
        />
        <KpiTile
          label="Post Opens (24h)"
          value={stats.postOpens24h.toLocaleString()}
          icon={MousePointerClick}
          tone="blue"
        />
        <KpiTile
          label="Watch Opens (24h)"
          value={stats.watchOpens24h.toLocaleString()}
          icon={Activity}
          tone="green"
        />
      </div>

      {/* ═══════════ INCIDENT HOTSPOTS ═══════════ */}
      <CollapsibleSection
        title="Incident Hotspots"
        badge={`${hotspots.length} areas`}
        defaultOpen={true}
      >
        {hotspots.length === 0 ? (
          <p className="text-sm text-dark-500 py-4 text-center">
            No location data available
          </p>
        ) : (
          <div className="space-y-2">
            {hotspots.map((h, i) => {
              const riskLevel =
                h.count >= 20
                  ? { label: "High", color: "text-red-400 bg-red-500/15" }
                  : h.count >= 10
                  ? {
                      label: "Medium",
                      color: "text-orange-400 bg-orange-500/15",
                    }
                  : h.count >= 5
                  ? {
                      label: "Low",
                      color: "text-yellow-400 bg-yellow-500/15",
                    }
                  : {
                      label: "Minimal",
                      color: "text-green-400 bg-green-500/15",
                    };
              const maxCount = hotspots[0]?.count || 1;
              const barWidth = Math.round((h.count / maxCount) * 100);

              return (
                <div
                  key={h.area}
                  className="p-3.5 rounded-xl bg-white/5 border border-white/5 hover:bg-white/8 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span
                      className={`text-xs font-bold w-7 h-7 rounded-lg flex items-center justify-center border ${
                        i === 0
                          ? "bg-red-500/15 text-red-400 border-red-500/25"
                          : i === 1
                          ? "bg-orange-500/15 text-orange-400 border-orange-500/25"
                          : i === 2
                          ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/25"
                          : "bg-dark-800 text-dark-500 border-dark-700"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">
                        {h.area}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-dark-400">
                        <span
                          className="flex items-center gap-1"
                          style={{ color: h.topCategoryColor }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: h.topCategoryColor }}
                          />
                          {h.topCategoryName}
                        </span>
                        <span>Peak: {h.peakTime}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${riskLevel.color}`}
                      >
                        {riskLevel.label}
                      </span>
                      <span className="text-lg font-bold text-primary-400">
                        {h.count}
                      </span>
                    </div>
                  </div>
                  {/* Relative bar */}
                  <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${barWidth}%`,
                        background: h.topCategoryColor,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* ═══════════ COLLAPSIBLE TOP SCREENS + EVENTS ═══════════ */}
      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <CollapsibleSection title="Top Screens" badge="24 HOURS">
          {topScreens.length === 0 && (
            <p className="text-sm text-dark-500">No data yet</p>
          )}
          {topScreens.map((s, i) => (
            <div
              key={s.screen}
              className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
            >
              <span className="text-sm text-dark-200 font-medium flex items-center gap-3">
                <span
                  className={`text-xs font-bold w-6 h-6 rounded flex items-center justify-center ${
                    i < 3
                      ? "bg-primary-500/20 text-primary-300"
                      : "bg-dark-800 text-dark-500"
                  }`}
                >
                  #{i + 1}
                </span>
                {s.screen}
              </span>
              <span className="text-xs font-mono font-bold text-white">
                {s.count}
              </span>
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection title="Top Events" badge="24 HOURS">
          {topEvents.length === 0 && (
            <p className="text-sm text-dark-500">No data yet</p>
          )}
          {topEvents.map((e, i) => (
            <div
              key={e.event_name}
              className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
            >
              <span className="text-sm text-dark-200 font-medium flex items-center gap-3">
                <span
                  className={`text-xs font-bold w-6 h-6 rounded flex items-center justify-center ${
                    i < 3
                      ? "bg-blue-500/20 text-blue-300"
                      : "bg-dark-800 text-dark-500"
                  }`}
                >
                  #{i + 1}
                </span>
                {e.event_name}
              </span>
              <span className="text-xs font-mono font-bold text-blue-300">
                {e.count}
              </span>
            </div>
          ))}
        </CollapsibleSection>
      </div>
    </HudShell>
  );
}