"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Loader2, BarChart3, Flag, CheckCircle, XCircle, Eye } from "lucide-react";
import { subDays } from "date-fns";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";

export default function GuardianStatsPage() {
    useScrollRestore("guardian:stats");
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState({
    total: 0,
    last24h: 0,
    approved: 0,
    removed: 0,
    blurred: 0,
    escalated: 0,
    pendingQueue: 0,
  });

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;
      setLoading(true);

      try {
        const since24h = subDays(new Date(), 1).toISOString();

        const [{ count: total }, { count: last24h }, { count: pendingQueue }] = await Promise.all([
          supabase.from("guardian_actions").select("*", { count: "exact", head: true }).eq("guardian_id", user.id),
          supabase
            .from("guardian_actions")
            .select("*", { count: "exact", head: true })
            .eq("guardian_id", user.id)
            .gte("created_at", since24h),
          supabase.from("flagged_content").select("*", { count: "exact", head: true }).eq("status", "pending"),
        ]);

        // Breakdown (simple counts by action string)
        const { data: rows } = await supabase
          .from("guardian_actions")
          .select("action,created_at")
          .eq("guardian_id", user.id)
          .limit(2000);

        let approved = 0, removed = 0, blurred = 0, escalated = 0;
        for (const r of rows || []) {
          const a = (r.action || "").toLowerCase();
          if (a.includes("approve")) approved++;
          else if (a.includes("remove")) removed++;
          else if (a.includes("blur")) blurred++;
          else if (a.includes("escalate")) escalated++;
        }

        setStats({
          total: total || 0,
          last24h: last24h || 0,
          approved,
          removed,
          blurred,
          escalated,
          pendingQueue: pendingQueue || 0,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user?.id]);

  if (loading) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Skeleton className="h-6 w-28 mb-2" />
        <Skeleton className="h-4 w-48" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="glass-card">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="h-6 w-14 mb-2" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

  const cards = [
    { label: "Total Actions", value: stats.total, icon: BarChart3 },
    { label: "Actions (24h)", value: stats.last24h, icon: BarChart3 },
    { label: "Approved", value: stats.approved, icon: CheckCircle },
    { label: "Removed", value: stats.removed, icon: XCircle },
    { label: "Blurred", value: stats.blurred, icon: Eye },
    { label: "Escalated", value: stats.escalated, icon: Flag },
    { label: "Pending Queue", value: stats.pendingQueue, icon: Flag },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-100 flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-primary-400" />
          My Stats
        </h1>
        <p className="text-dark-400 mt-1">Your impact as a Guardian</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="glass-card">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary-600/10">
                  <Icon className="w-5 h-5 text-primary-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-dark-100">{c.value}</p>
                  <p className="text-sm text-dark-400">{c.label}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}