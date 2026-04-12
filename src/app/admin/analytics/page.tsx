"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { usePageCache } from "@/context/PageCacheContext";
import { CATEGORIES, SOS_TAGS } from "@/lib/types";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";
import type { MapHelper } from "@/components/admin/AdminLiveMap";
import { useRouter } from "next/navigation";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

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
  Download, 
  Calendar, 
  Filter, 
  ExternalLink, 
  RefreshCw, 
  FileText,
  CheckCircle2,
} from "lucide-react";
import { subDays, formatDistanceToNow } from "date-fns";

/* ── dynamic map (no SSR) ── */
const AdminLiveMap = dynamic(() => import("@/components/admin/AdminLiveMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-dark-900 rounded-xl">
      <PejaSpinner className="w-6 h-6" />
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

type ActivityEvent = {
  id: string;
  type: "incident" | "sos" | "sos_resolved" | "helper_dispatched" | "helper_arrived" | "flag" | "new_user";
  title: string;
  description: string;
  userId?: string;
  userName?: string;
  userAvatar?: string | null;
  relatedId?: string;
  category?: string;
  timestamp: string;
  metadata?: Record<string, any>;
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
const pageCache = usePageCache();
  const _cached = pageCache.get<any>("admin:analytics:all");

  const [loading, setLoading] = useState(!_cached);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [flashFields, setFlashFields] = useState<Record<string, boolean>>({});

  /* ── core stats ── */
const [stats, setStats] = useState(_cached?.stats || {
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
    // ↓ ADD THESE
    usersWhoPosted: 0,
    usersWhoSOS: 0,
    confirmedPosts: 0,
    totalConfirmations: 0,
peakHours: "No data yet",
  });
  type Stats = typeof stats;
  /* ── chart state ── */
/* ── chart state ── */
  const [streamData, setStreamData] = useState<StreamPoint[]>(
    _cached?.streamData || makeStreamSeed(60)
  );
  const [seriesData, setSeriesData] = useState(
    (_cached?.seriesData || []) as { day: string; posts: number; sos: number; flags: number }[]
  );
  const [categoryData, setCategoryData] = useState(
    (_cached?.categoryData || []) as { name: string; count: number; color: string }[]
  );
  /* ── tables ── */
  const [topFeatures, setTopFeatures] = useState(
    (_cached?.topFeatures || []) as { name: string; count: number; pct: number }[]
  );
  /* ── hotspots ── */
  const [hotspots, setHotspots] = useState<Hotspot[]>(_cached?.hotspots || []);

  /* ── live feed ── */
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);

  /* ── helper dispatch ── */
  const [mapHelpers, setMapHelpers] = useState<MapHelper[]>([]);
  const [dispatches, setDispatches] = useState<SOSDispatch[]>([]);
  const helperPollRef = useRef<NodeJS.Timeout | null>(null);

  const router = useRouter();

  /* ── activity log ── */
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  const [activityFilter, setActivityFilter] = useState("all");
  const [activityPage, setActivityPage] = useState(1);
  const [activityLoading, setActivityLoading] = useState(false);

  /* ── report export ── */
  const [reportRange, setReportRange] = useState("week");
  const [reportLoading, setReportLoading] = useState(false);
  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");

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
     FETCH ACTIVITY LOG
     ══════════════════════════════════════════════ */
  const fetchActivityLog = useCallback(async () => {
    setActivityLoading(true);
    try {
      const [postsRes, sosRes, helpersRes, flagsRes, newUsersRes] = await Promise.all([
        supabase.from("posts")
          .select("id, user_id, category, comment, address, status, created_at")
          .order("created_at", { ascending: false }).limit(150),
        supabase.from("sos_alerts")
          .select("id, user_id, status, tag, address, created_at")
          .order("created_at", { ascending: false }).limit(100),
        supabase.from("sos_helpers")
          .select("id, user_id, sos_id, milestone, eta, created_at, updated_at")
          .order("created_at", { ascending: false }).limit(100),
        supabase.from("flagged_content")
          .select("id, reporter_id, content_type, reason, status, created_at")
          .order("created_at", { ascending: false }).limit(100),
        supabase.from("users")
          .select("id, full_name, avatar_url, created_at")
          .order("created_at", { ascending: false }).limit(50),
      ]);

      // Collect all user IDs
      const userIds = new Set<string>();
      (postsRes.data || []).forEach((p: any) => p.user_id && userIds.add(p.user_id));
      (sosRes.data || []).forEach((s: any) => s.user_id && userIds.add(s.user_id));
      (helpersRes.data || []).forEach((h: any) => h.user_id && userIds.add(h.user_id));
      (flagsRes.data || []).forEach((f: any) => f.reporter_id && userIds.add(f.reporter_id));

      const { data: userData } = userIds.size > 0
        ? await supabase.from("users").select("id, full_name, avatar_url").in("id", Array.from(userIds))
        : { data: [] };

      const userMap: Record<string, { name: string; avatar: string | null }> = {};
      (userData || []).forEach((u: any) => {
        userMap[u.id] = { name: u.full_name || "Unknown", avatar: u.avatar_url };
      });

      const events: ActivityEvent[] = [];

      // Incident reports
      (postsRes.data || []).forEach((p: any) => {
        const cat = CATEGORIES.find((c) => c.id === p.category);
        const u = userMap[p.user_id];
        events.push({
          id: `post-${p.id}`,
          type: "incident",
          title: cat?.name || p.category,
          description: p.comment?.slice(0, 120) || "No description",
          userId: p.user_id,
          userName: u?.name || "Unknown",
          userAvatar: u?.avatar,
          relatedId: p.id,
          category: p.category,
          timestamp: p.created_at,
          metadata: { address: p.address, status: p.status },
        });
      });

      // SOS alerts
      (sosRes.data || []).forEach((s: any) => {
        const u = userMap[s.user_id];
        const tagInfo = s.tag ? SOS_TAGS.find((t) => t.id === s.tag) : null;
        events.push({
          id: `sos-${s.id}`,
          type: s.status === "active" ? "sos" : "sos_resolved",
          title: s.status === "active" ? "SOS Activated" : `SOS ${s.status}`,
          description: tagInfo ? `${tagInfo.icon} ${tagInfo.label}` : "Emergency alert",
          userId: s.user_id,
          userName: u?.name || "Unknown",
          userAvatar: u?.avatar,
          relatedId: s.id,
          timestamp: s.created_at,
          metadata: { address: s.address, status: s.status, tag: s.tag },
        });
      });

      // Helpers
      (helpersRes.data || []).forEach((h: any) => {
        const u = userMap[h.user_id];
        events.push({
          id: `helper-${h.id}`,
          type: h.milestone === "arrived" ? "helper_arrived" : "helper_dispatched",
          title: h.milestone === "arrived" ? "Helper Arrived" : "Helper Dispatched",
          description: h.milestone === "arrived"
            ? "Arrived at SOS location"
            : `Responding to SOS • ETA ${h.eta || "?"} min`,
          userId: h.user_id,
          userName: u?.name || "Unknown",
          userAvatar: u?.avatar,
          relatedId: h.sos_id,
          timestamp: h.milestone === "arrived" ? (h.updated_at || h.created_at) : h.created_at,
          metadata: { milestone: h.milestone, eta: h.eta, sosId: h.sos_id },
        });
      });

      // Flags
      (flagsRes.data || []).forEach((f: any) => {
        const u = userMap[f.reporter_id];
        events.push({
          id: `flag-${f.id}`,
          type: "flag",
          title: "Content Flagged",
          description: `${f.content_type} - ${f.reason || "No reason"}`,
          userId: f.reporter_id,
          userName: u?.name || "Unknown",
          userAvatar: u?.avatar,
          relatedId: f.content_id,
          timestamp: f.created_at,
          metadata: { reason: f.reason, contentType: f.content_type, status: f.status },
        });
      });

      // New users
      (newUsersRes.data || []).forEach((u: any) => {
        events.push({
          id: `user-${u.id}`,
          type: "new_user",
          title: "New User Joined",
          description: `${u.full_name || "Anonymous"} created an account`,
          userId: u.id,
          userName: u.full_name || "Anonymous",
          userAvatar: u.avatar_url,
          timestamp: u.created_at,
        });
      });

      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setActivityLog(events);
    } catch {
      /* silent */
    } finally {
      setActivityLoading(false);
    }
  }, []);

    /* ══════════════════════════════════════════════
     GENERATE PDF REPORT
     ══════════════════════════════════════════════ */
  const generateReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const now = new Date();
      let fromDate: Date;
      let toDate: Date = now;

      switch (reportRange) {
        case "today":
          fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "week":
          fromDate = subDays(now, 7);
          break;
        case "month":
          fromDate = subDays(now, 30);
          break;
        case "all":
          fromDate = new Date(2020, 0, 1);
          break;
        case "custom":
          fromDate = customDateFrom ? new Date(customDateFrom) : subDays(now, 7);
          toDate = customDateTo ? new Date(customDateTo + "T23:59:59") : now;
          break;
        default:
          fromDate = subDays(now, 7);
      }

      const fromISO = fromDate.toISOString();
      const toISO = toDate.toISOString();

      // Fetch all data for the range
      const [postsRes, sosRes, helpersRes, flagsRes, newUsersRes] = await Promise.all([
        supabase.from("posts")
          .select("id, user_id, category, comment, address, status, created_at")
          .gte("created_at", fromISO).lte("created_at", toISO)
          .order("created_at", { ascending: false }).limit(5000),
        supabase.from("sos_alerts")
          .select("id, user_id, status, tag, address, created_at")
          .gte("created_at", fromISO).lte("created_at", toISO)
          .order("created_at", { ascending: false }).limit(2000),
        supabase.from("sos_helpers")
          .select("id, user_id, sos_id, milestone, eta, created_at")
          .gte("created_at", fromISO).lte("created_at", toISO)
          .order("created_at", { ascending: false }).limit(2000),
        supabase.from("flagged_content")
          .select("id, reporter_id, content_type, reason, status, created_at")
          .gte("created_at", fromISO).lte("created_at", toISO)
          .order("created_at", { ascending: false }).limit(2000),
        supabase.from("users")
          .select("id, full_name, created_at")
          .gte("created_at", fromISO).lte("created_at", toISO)
          .order("created_at", { ascending: false }).limit(1000),
      ]);

      // Resolve user names
      const userIds = new Set<string>();
      (postsRes.data || []).forEach((p: any) => userIds.add(p.user_id));
      (sosRes.data || []).forEach((s: any) => userIds.add(s.user_id));
      (helpersRes.data || []).forEach((h: any) => userIds.add(h.user_id));
      (flagsRes.data || []).forEach((f: any) => userIds.add(f.reporter_id));

      const { data: allUsers } = userIds.size > 0
        ? await supabase.from("users").select("id, full_name").in("id", Array.from(userIds))
        : { data: [] };

      const uMap: Record<string, string> = {};
      (allUsers || []).forEach((u: any) => { uMap[u.id] = u.full_name || "Unknown"; });

      // Build table rows
      const rows: { time: string; type: string; user: string; detail: string; extra: string }[] = [];

      (postsRes.data || []).forEach((p: any) => {
        const cat = CATEGORIES.find((c) => c.id === p.category);
        rows.push({
          time: new Date(p.created_at).toLocaleString(),
          type: "Incident Report",
          user: uMap[p.user_id] || "Unknown",
          detail: cat?.name || p.category,
          extra: `${p.address || "No location"} • ${p.status}`,
        });
      });

      (sosRes.data || []).forEach((s: any) => {
        const tagInfo = s.tag ? SOS_TAGS.find((t) => t.id === s.tag) : null;
        rows.push({
          time: new Date(s.created_at).toLocaleString(),
          type: `SOS (${s.status})`,
          user: uMap[s.user_id] || "Unknown",
          detail: tagInfo ? `${tagInfo.icon} ${tagInfo.label}` : "Emergency",
          extra: s.address || "No location",
        });
      });

      (helpersRes.data || []).forEach((h: any) => {
        rows.push({
          time: new Date(h.created_at).toLocaleString(),
          type: h.milestone === "arrived" ? "Helper Arrived" : "Helper Dispatched",
          user: uMap[h.user_id] || "Unknown",
          detail: h.milestone === "arrived" ? "Arrived at SOS" : `ETA ${h.eta || "?"} min`,
          extra: `SOS: ${h.sos_id?.slice(0, 8) || "-"}`,
        });
      });

      (flagsRes.data || []).forEach((f: any) => {
        rows.push({
          time: new Date(f.created_at).toLocaleString(),
          type: "Content Flagged",
          user: uMap[f.reporter_id] || "Unknown",
          detail: f.reason || "No reason",
          extra: `${f.content_type} • ${f.status}`,
        });
      });

      (newUsersRes.data || []).forEach((u: any) => {
        rows.push({
          time: new Date(u.created_at).toLocaleString(),
          type: "New User",
          user: u.full_name || "Anonymous",
          detail: "Account created",
          extra: "",
        });
      });

      rows.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      // Summary counts
      const summary = {
        incidents: (postsRes.data || []).length,
        sos: (sosRes.data || []).length,
        helpers: (helpersRes.data || []).length,
        flags: (flagsRes.data || []).length,
        newUsers: (newUsersRes.data || []).length,
        total: rows.length,
      };

      const rangeLabel = reportRange === "custom"
        ? `${fromDate.toLocaleDateString()} - ${toDate.toLocaleDateString()}`
        : reportRange === "today" ? "Today"
        : reportRange === "week" ? "Last 7 Days"
        : reportRange === "month" ? "Last 30 Days"
        : "All Time";

      // Generate HTML
      const tableRows = rows.map((r) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;white-space:nowrap">${r.time}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600">${r.type}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px">${r.user}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px">${r.detail}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">${r.extra}</td>
        </tr>
      `).join("");

      const html = `<!DOCTYPE html><html><head><title>PEJA Report - ${rangeLabel}</title>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#111827; padding:40px; }
          @media print { body { padding:20px; } .no-print { display:none; } }
          .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:32px; padding-bottom:16px; border-bottom:2px solid #111827; }
          .header h1 { font-size:24px; font-weight:800; letter-spacing:-0.5px; }
          .header p { font-size:13px; color:#6b7280; }
          .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:32px; }
          .summary-card { padding:16px; border:1px solid #e5e7eb; border-radius:8px; text-align:center; }
          .summary-card .num { font-size:28px; font-weight:800; color:#111827; }
          .summary-card .label { font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; margin-top:4px; }
          table { width:100%; border-collapse:collapse; font-size:12px; }
          th { padding:10px 12px; text-align:left; background:#f9fafb; border-bottom:2px solid #e5e7eb; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#6b7280; }
          tr:hover { background:#f9fafb; }
          .footer { margin-top:32px; padding-top:16px; border-top:1px solid #e5e7eb; font-size:11px; color:#9ca3af; text-align:center; }
          .print-btn { position:fixed; bottom:24px; right:24px; padding:12px 24px; background:#7c3aed; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; box-shadow:0 4px 12px rgba(124,58,237,0.3); }
          .print-btn:hover { background:#6d28d9; }
        </style>
      </head><body>
        <button class="print-btn no-print" onclick="window.print()">Save as PDF</button>
        <div class="header">
          <div>
            <h1>PEJA Analytics Report</h1>
            <p>Period: ${rangeLabel}</p>
          </div>
          <div style="text-align:right">
            <p style="font-size:11px;color:#9ca3af">Generated ${new Date().toLocaleString()}</p>
            <p style="font-size:11px;color:#9ca3af">${summary.total} total events</p>
          </div>
        </div>
        <div class="summary">
          <div class="summary-card"><div class="num">${summary.incidents}</div><div class="label">Incident Reports</div></div>
          <div class="summary-card"><div class="num">${summary.sos}</div><div class="label">SOS Alerts</div></div>
          <div class="summary-card"><div class="num">${summary.helpers}</div><div class="label">Helpers Dispatched</div></div>
          <div class="summary-card"><div class="num">${summary.flags}</div><div class="label">Content Flagged</div></div>
          <div class="summary-card"><div class="num">${summary.newUsers}</div><div class="label">New Users</div></div>
        </div>
        <table>
          <thead><tr><th>Time</th><th>Event Type</th><th>User</th><th>Details</th><th>Extra</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div class="footer">PEJA (Your Brother's Keeper) - Confidential Report</div>
      </body></html>`;

      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    } catch {
      /* silent */
    } finally {
      setReportLoading(false);
    }
  }, [reportRange, customDateFrom, customDateTo]);

  // Cache analytics data after load
  useEffect(() => {
    if (loading) return;
    pageCache.set("admin:analytics:all", {
      stats, streamData, seriesData, categoryData, topFeatures, hotspots,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, stats, seriesData, categoryData, topFeatures, hotspots]);

    useEffect(() => {
    if (!loading) fetchActivityLog();
  }, [loading, fetchActivityLog]);

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
    const handleExpand = () => setMapFullscreen(true);
    window.addEventListener("peja-expand-admin-map", handleExpand);
    return () => window.removeEventListener("peja-expand-admin-map", handleExpand);
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
          .select("category, user_id, status, confirmations")
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

                /* ── engagement funnel data ── */
        const usersWhoPosted = new Set(
          (catPosts || []).map((p: any) => p.user_id).filter(Boolean)
        ).size;
        const confirmedPosts = (catPosts || []).filter(
          (p: any) => (p.confirmations || 0) > 0
        ).length;
        const totalConfirmations = (catPosts || []).reduce(
          (sum: number, p: any) => sum + (p.confirmations || 0), 0
        );

        const { data: sosUserData } = await supabase
          .from("sos_alerts")
          .select("user_id")
          .limit(10000);
        const usersWhoSOS = new Set(
          (sosUserData || []).map((s: any) => s.user_id).filter(Boolean)
        ).size;

        /* ── peak hours ── */
        const hourBuckets = Array.from({ length: 24 }, () => 0);
        for (const e of ev24 || []) {
          const h = new Date((e as any).created_at).getHours();
          hourBuckets[h]++;
        }
        const totalEvForPeak = hourBuckets.reduce((a, b) => a + b, 0);
        let peakHours = "No data yet";
        if (totalEvForPeak > 0) {
          const sorted = hourBuckets
            .map((count, hour) => ({ hour, count }))
            .filter((h) => h.count > 0)
            .sort((a, b) => b.count - a.count);
          if (sorted.length > 0) {
            const fmt = (h: number) =>
              h === 0 ? "12 AM" : h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`;
            peakHours = sorted
              .slice(0, 2)
              .map((h) => fmt(h.hour))
              .join(" & ");
          }
        }

        /* ── feature usage ── */
        const featureCounts = new Map<string, number>();
        for (const e of ev24 || []) {
          if (e.event_name !== "page_view" || !e.screen) continue;
          const s = (e.screen as string).replace(/\/$/, "") || "/";
          let feature = "Other";
          if (s === "/" || s === "") feature = "Home Feed";
          else if (s.startsWith("/watch")) feature = "Watch";
          else if (s.startsWith("/map")) feature = "Map";
          else if (s.startsWith("/create")) feature = "Create Post";
          else if (s.startsWith("/sos")) feature = "SOS";
          else if (s.startsWith("/messages")) feature = "Messages";
          else if (s.startsWith("/notifications")) feature = "Notifications";
          else if (s.startsWith("/profile")) feature = "Profile";
          else if (s.startsWith("/search")) feature = "Search";
          else if (s.startsWith("/settings")) feature = "Settings";
          else if (s.startsWith("/post")) feature = "Post Detail";
          else if (s.startsWith("/admin")) feature = "Admin";
          else if (s.startsWith("/guardian")) feature = "Guardian";
          else feature = "Other";
          featureCounts.set(feature, (featureCounts.get(feature) || 0) + 1);
        }
        const totalFeatureViews = [...featureCounts.values()].reduce((a, b) => a + b, 0);
        const topFeaturesArr = [...featureCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([name, count]) => ({
            name,
            count,
            pct: totalFeatureViews > 0 ? Math.round((count / totalFeatureViews) * 100) : 0,
          }));
        setTopFeatures(topFeaturesArr);

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
           usersWhoPosted,
          usersWhoSOS,
          confirmedPosts,
          totalConfirmations,
          peakHours,
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
          setStats((s: Stats) => ({
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
            setCategoryData((prev: { name: string; count: number; color: string }[]) => {
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
          setStats((s: Stats) => ({ ...s, activeSOS: s.activeSOS + 1 }));
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
            setStats((st: Stats) => ({
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
          setStats((s: Stats) => ({ ...s, pendingFlags: s.pendingFlags + 1 }));
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
            setStats((s: Stats) => ({
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
          setStats((s: Stats) => ({
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
    <>
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
            <PejaSpinner className="w-3 h-3 mr-1.5 inline" /> Refresh
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
                    stroke="rgba(255, 255, 255, 0.04)"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    stroke="rgba(255, 255, 255, 0.2)"
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
                      background: "#1a111c",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 12,
                    }}
                    labelStyle={{ color: "#ffffff", fontWeight: 600 }}
                    itemStyle={{ color: "#e2e8f0" }}
                    cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={18}>
                    {categoryData.map((entry: { name: string; count: number; color: string }, idx: number) => (
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
          title="Export Reports"
          subtitle="Download platform data as PDF"
          right={
            <div className="pill pill-purple flex items-center gap-1.5">
              <Download className="w-3 h-3" />
              PDF
            </div>
          }
        >
          <div className="space-y-4">
            {/* Range selector */}
            <div className="flex flex-wrap gap-2">
              {[
                { value: "today", label: "Today" },
                { value: "week", label: "7 Days" },
                { value: "month", label: "30 Days" },
                { value: "all", label: "All Time" },
                { value: "custom", label: "Custom" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setReportRange(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    reportRange === opt.value
                      ? "bg-primary-600/20 text-primary-300 border-primary-500/30"
                      : "bg-white/5 text-dark-400 border-white/10 hover:bg-white/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Custom date inputs */}
            {reportRange === "custom" && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-dark-500 uppercase tracking-wider font-bold mb-1 block">From</label>
                  <input
                    type="date"
                    value={customDateFrom}
                    onChange={(e) => setCustomDateFrom(e.target.value)}
                    className="w-full h-9 px-3 bg-dark-800 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-primary-500/50"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-dark-500 uppercase tracking-wider font-bold mb-1 block">To</label>
                  <input
                    type="date"
                    value={customDateTo}
                    onChange={(e) => setCustomDateTo(e.target.value)}
                    className="w-full h-9 px-3 bg-dark-800 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-primary-500/50"
                  />
                </div>
              </div>
            )}

            {/* What's included */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/5">
              <p className="text-[10px] text-dark-500 uppercase tracking-wider font-bold mb-2">Report includes</p>
              <div className="flex flex-wrap gap-1.5">
                {["Incidents", "SOS Alerts", "Helpers", "Flags", "New Users"].map((item) => (
                  <span key={item} className="text-[10px] text-dark-300 bg-white/5 px-2 py-0.5 rounded border border-white/5">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* Download button */}
            <button
              onClick={generateReport}
              disabled={reportLoading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                boxShadow: "0 4px 15px rgba(124,58,237,0.3)",
              }}
            >
              {reportLoading ? (
                <PejaSpinner className="w-4 h-4" />
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Generate & Download PDF
                </>
              )}
            </button>
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

            {/* ═══════════ ACTIVITY LOG ═══════════ */}
      <HudPanel
        className="relative overflow-hidden mb-6"
        title="Platform Activity Log"
        subtitle={`${activityLog.length} events recorded`}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={fetchActivityLog}
              disabled={activityLoading}
              className="p-2 rounded-lg bg-white/5 border border-white/10 text-dark-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${activityLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      >
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { value: "all", label: "All Events", icon: Activity },
            { value: "incident", label: "Incidents", icon: Zap },
            { value: "sos", label: "SOS & Helpers", icon: AlertTriangle },
            { value: "flag", label: "Flags", icon: Flag },
            { value: "new_user", label: "New Users", icon: UserPlus },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => { setActivityFilter(f.value); setActivityPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                activityFilter === f.value
                  ? "bg-primary-600/20 text-primary-300 border-primary-500/30"
                  : "bg-white/5 text-dark-400 border-white/10 hover:bg-white/10"
              }`}
            >
              <f.icon className="w-3 h-3" />
              {f.label}
            </button>
          ))}
        </div>

        {/* Event list */}
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto scrollbar-hide">
          {activityLoading && activityLog.length === 0 ? (
            <div className="flex justify-center py-12">
              <PejaSpinner className="w-6 h-6" />
            </div>
          ) : (() => {
            const filtered = activityLog.filter((e) => {
              if (activityFilter === "all") return true;
              if (activityFilter === "sos")
                return ["sos", "sos_resolved", "helper_dispatched", "helper_arrived"].includes(e.type);
              if (activityFilter === "incident") return e.type === "incident";
              if (activityFilter === "flag") return e.type === "flag";
              if (activityFilter === "new_user") return e.type === "new_user";
              return true;
            });
            const paginated = filtered.slice(0, activityPage * 30);
            const hasMore = paginated.length < filtered.length;

            if (filtered.length === 0) {
              return (
                <div className="text-center py-12 text-dark-500">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No events found</p>
                </div>
              );
            }

            const typeConfig: Record<string, { icon: any; color: string; bg: string }> = {
              incident: { icon: Zap, color: "text-purple-400", bg: "bg-purple-500/15 border-purple-500/25" },
              sos: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/15 border-red-500/25" },
              sos_resolved: { icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/15 border-green-500/25" },
              helper_dispatched: { icon: Navigation, color: "text-blue-400", bg: "bg-blue-500/15 border-blue-500/25" },
              helper_arrived: { icon: CheckCircle2, color: "text-green-400", bg: "bg-green-500/15 border-green-500/25" },
              flag: { icon: Flag, color: "text-orange-400", bg: "bg-orange-500/15 border-orange-500/25" },
              new_user: { icon: UserPlus, color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/25" },
            };

            return (
              <>
                {paginated.map((event) => {
                  const config = typeConfig[event.type] || typeConfig.incident;
                  const Icon = config.icon;
                  const cat = event.category ? CATEGORIES.find((c) => c.id === event.category) : null;

                  return (
                    <div
                      key={event.id}
                      className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors group"
                    >
                      {/* Type icon */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${config.bg}`}>
                        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-bold ${config.color}`}>
                            {event.title}
                          </span>
                          {cat && (
                            <span className="text-[10px] text-dark-500 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                              {cat.name}
                            </span>
                          )}
                          {event.metadata?.status && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              event.metadata.status === "live" || event.metadata.status === "active"
                                ? "text-red-400 bg-red-500/10"
                                : event.metadata.status === "resolved"
                                ? "text-green-400 bg-green-500/10"
                                : "text-dark-400 bg-white/5"
                            }`}>
                              {event.metadata.status}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-dark-300 mt-0.5 line-clamp-1">
                          {event.description}
                        </p>

                        {event.metadata?.address && (
                          <p className="text-[11px] text-dark-500 mt-0.5 flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{event.metadata.address}</span>
                          </p>
                        )}

                        {/* User row - clickable */}
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="w-5 h-5 rounded-full overflow-hidden border border-white/10 shrink-0 bg-dark-800">
                            {event.userAvatar ? (
                              <img src={event.userAvatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[8px] text-dark-500 font-bold">
                                {event.userName?.[0] || "?"}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (event.userId) {
                                router.push(`/admin/users?highlight=${event.userId}`);
                              }
                            }}
                            className="text-[11px] text-dark-300 hover:text-primary-300 transition-colors font-medium flex items-center gap-1 group/user"
                          >
                            {event.userName}
                            <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover/user:opacity-100 transition-opacity" />
                          </button>
                        </div>
                      </div>

                      {/* Timestamp */}
                      <div className="text-[10px] text-dark-500 whitespace-nowrap shrink-0 text-right">
                        <p>{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}</p>
                        <p className="mt-0.5 opacity-60">
                          {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {hasMore && (
                  <button
                    onClick={() => setActivityPage((p) => p + 1)}
                    className="w-full py-3 rounded-xl text-xs font-medium text-primary-400 bg-primary-500/5 border border-primary-500/10 hover:bg-primary-500/10 transition-colors mt-2"
                  >
                    Load more ({filtered.length - paginated.length} remaining)
                  </button>
                )}
              </>
            );
          })()}
        </div>
      </HudPanel>

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

      {/* ═══════════ PLATFORM HEALTH ═══════════ */}
      <HudPanel
        className="relative overflow-hidden mt-4"
        title="Platform Health & Engagement"
        subtitle="User adoption, content outcomes & feature usage"
        right={<div className="pill pill-green">Health</div>}
      >
        <div className="space-y-6">
          {/* ── Engagement Funnel ── */}
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold mb-3">
              User Engagement Funnel
            </p>
            <div className="space-y-3">
              {[
                {
                  label: "Registered Users",
                  value: stats.totalUsers,
                  pct: 100,
                  color: "#8b5cf6",
                  sub: "Total signups",
                },
                {
                  label: "Active This Week",
                  value: stats.wau,
                  pct: stats.totalUsers > 0 ? Math.round((stats.wau / stats.totalUsers) * 100) : 0,
                  color: "#3b82f6",
                  sub: "Opened app in last 7 days",
                },
                {
                  label: "Created a Post",
                  value: stats.usersWhoPosted,
                  pct: stats.totalUsers > 0 ? Math.round((stats.usersWhoPosted / stats.totalUsers) * 100) : 0,
                  color: "#22c55e",
                  sub: "Users who reported an incident",
                },
                {
                  label: "User SOS",
                  value: stats.usersWhoSOS,
                  pct: stats.totalUsers > 0 ? Math.round((stats.usersWhoSOS / stats.totalUsers) * 100) : 0,
                  color: "#ef4444",
                  sub: "Users who triggered emergency",
                },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-dark-200">{item.label}</span>
                      <span className="text-xs text-dark-500">- {item.sub}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{item.value.toLocaleString()}</span>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{
                          color: item.color,
                          background: `${item.color}15`,
                        }}
                      >
                        {item.pct}%
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-dark-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.max(item.pct, item.value > 0 ? 3 : 0)}%`,
                        background: item.color,
                        opacity: 0.75,
                        boxShadow: `0 0 8px ${item.color}40`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-white/5" />

          {/* ── Health Metrics ── */}
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold mb-3">
              Content & Response Health
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Confirmation Rate */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-2xl font-bold text-white leading-none mb-1">
                  {stats.totalPosts > 0
                    ? `${Math.round((stats.confirmedPosts / stats.totalPosts) * 100)}%`
                    : "—"}
                </p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wider font-bold">Confirmed Rate</p>
                <p className="text-[10px] text-dark-600 mt-0.5">
                  {stats.confirmedPosts} of {stats.totalPosts} confirmed • {stats.totalConfirmations} total confirms
                </p>
              </div>

              {/* Peak Activity */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-lg font-bold text-white leading-none mb-1">
                  {stats.peakHours}
                </p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wider font-bold">Peak Hours</p>
                <p className="text-[10px] text-dark-600 mt-0.5">Most user activity</p>
              </div>

              {/* Guardian Coverage */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-2xl font-bold text-white leading-none mb-1">
                  {stats.totalUsers > 0
                    ? `${Math.round((stats.totalGuardians / stats.totalUsers) * 100)}%`
                    : "—"}
                </p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wider font-bold">Guardian Coverage</p>
                <p className="text-[10px] text-dark-600 mt-0.5">
                  {stats.totalGuardians} guardian{stats.totalGuardians !== 1 ? "s" : ""} for {stats.totalUsers} users
                </p>
              </div>

              {/* Content Live Rate */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-2xl font-bold text-white leading-none mb-1">
                  {stats.totalPosts > 0
                    ? `${Math.round((stats.livePosts / stats.totalPosts) * 100)}%`
                    : "—"}
                </p>
                <p className="text-[10px] text-dark-500 uppercase tracking-wider font-bold">Live Posts</p>
                <p className="text-[10px] text-dark-600 mt-0.5">
                  {stats.livePosts} currently active
                </p>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-white/5" />

          {/* ── Feature Usage ── */}
          <div>
            <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold mb-3">
              Feature Usage (24h)
            </p>
            {topFeatures.length === 0 ? (
              <div className="text-center py-6 text-dark-500">
                <Activity className="w-6 h-6 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Gathering usage data…</p>
                <p className="text-[10px] mt-1">Feature breakdown will appear as users interact with the app</p>
              </div>
            ) : (
              <div className="space-y-2">
                {topFeatures.map((f: { name: string; count: number; pct: number }, i: number) => {
                  const colors = [
                    "#8b5cf6", "#3b82f6", "#22c55e", "#eab308",
                    "#f97316", "#ef4444", "#ec4899", "#6366f1",
                  ];
                  const color = colors[i % colors.length];
                  return (
                    <div key={f.name} className="flex items-center gap-3">
                      <span className="text-xs text-dark-300 font-medium w-28 shrink-0 truncate">
                        {f.name}
                      </span>
                      <div className="flex-1 h-2 bg-dark-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.max(f.pct, 3)}%`,
                            background: color,
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs font-bold text-white w-8 text-right">{f.count}</span>
                        <span className="text-[10px] text-dark-500 w-8 text-right">{f.pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </HudPanel>
    </HudShell>

    {/* Fullscreen Map Modal */}
    {mapFullscreen && (
      <div className="fixed inset-0 z-[9999]" style={{ background: "#0c0818" }}>
       <div className="absolute top-14 left-3 z-10">
          <button
            onClick={() => setMapFullscreen(false)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 text-white text-sm font-medium hover:bg-white/15 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            Minimize
          </button>
          </div>
        <div className="w-full h-full">
          <AdminLiveMap helpers={mapHelpers} hideExpand />
        </div>
      </div>
   )}
    </>
  );
}