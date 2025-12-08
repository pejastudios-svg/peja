"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import {
  Flag,
  CheckCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  Loader2,
  ChevronRight,
} from "lucide-react";

interface GuardianStats {
  pendingReviews: number;
  myActionsToday: number;
  myActionsTotal: number;
  approvedToday: number;
  removedToday: number;
}

export default function GuardianDashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<GuardianStats | null>(null);
  const [recentQueue, setRecentQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const [
        { count: pendingReviews },
        { count: myActionsToday },
        { count: myActionsTotal },
        { data: recentQueueData },
      ] = await Promise.all([
        supabase.from("flagged_content").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("guardian_actions").select("*", { count: "exact", head: true }).eq("guardian_id", user.id).gte("created_at", todayISO),
        supabase.from("guardian_actions").select("*", { count: "exact", head: true }).eq("guardian_id", user.id),
        supabase.from("flagged_content").select(`
          id, reason, priority, status, created_at,
          posts:post_id (id, category, comment, address)
        `).eq("status", "pending").order("created_at", { ascending: false }).limit(5),
      ]);

      setStats({
        pendingReviews: pendingReviews || 0,
        myActionsToday: myActionsToday || 0,
        myActionsTotal: myActionsTotal || 0,
        approvedToday: 0,
        removedToday: 0,
      });

      setRecentQueue(recentQueueData || []);
    } catch (error) {
      console.error("Error fetching guardian data:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-dark-100">Welcome, Guardian</h1>
        <p className="text-dark-400 mt-1">Thank you for helping keep Peja safe</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="glass-card">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-orange-500/10">
              <Flag className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-dark-100">{stats?.pendingReviews || 0}</p>
              <p className="text-sm text-dark-400">Pending Reviews</p>
            </div>
          </div>
        </div>

        <div className="glass-card">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-green-500/10">
              <CheckCircle className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-dark-100">{stats?.myActionsToday || 0}</p>
              <p className="text-sm text-dark-400">Actions Today</p>
            </div>
          </div>
        </div>

        <div className="glass-card">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-primary-500/10">
              <TrendingUp className="w-5 h-5 text-primary-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-dark-100">{stats?.myActionsTotal || 0}</p>
              <p className="text-sm text-dark-400">Total Actions</p>
            </div>
          </div>
        </div>

        <div className="glass-card">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-blue-500/10">
              <Clock className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-dark-100">Active</p>
              <p className="text-sm text-dark-400">Your Status</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <Link href="/guardian/queue" className="glass-card hover:bg-white/5 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-4 rounded-xl bg-orange-500/10">
                <Flag className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-dark-100">Review Queue</h3>
                <p className="text-sm text-dark-400">
                  {stats?.pendingReviews || 0} items waiting for review
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-dark-500 group-hover:text-dark-300 transition-colors" />
          </div>
        </Link>

        <Link href="/guardian/guidelines" className="glass-card hover:bg-white/5 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-4 rounded-xl bg-primary-500/10">
                <AlertTriangle className="w-6 h-6 text-primary-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-dark-100">Guidelines</h3>
                <p className="text-sm text-dark-400">Review moderation rules</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-dark-500 group-hover:text-dark-300 transition-colors" />
          </div>
        </Link>
      </div>

      {/* Recent Queue Items */}
      <div className="glass-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-dark-100">Recent Flagged Content</h2>
          <Link href="/guardian/queue" className="text-sm text-primary-400 hover:underline">
            View All
          </Link>
        </div>

        {recentQueue.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
            <p className="text-dark-400">No pending reviews!</p>
            <p className="text-sm text-dark-500">Great job keeping Peja safe</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentQueue.map((item) => (
              <Link
                key={item.id}
                href={`/guardian/queue?review=${item.id}`}
                className="flex items-center gap-3 p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${
                  item.priority === "critical" ? "bg-red-500" :
                  item.priority === "high" ? "bg-orange-500" :
                  item.priority === "medium" ? "bg-yellow-500" :
                  "bg-green-500"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-dark-100 truncate capitalize">
                    {item.posts?.category?.replace(/_/g, " ") || "Unknown"}
                  </p>
                  <p className="text-xs text-dark-500 truncate">{item.reason}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs ${
                  item.priority === "critical" ? "bg-red-500/20 text-red-400" :
                  item.priority === "high" ? "bg-orange-500/20 text-orange-400" :
                  "bg-yellow-500/20 text-yellow-400"
                }`}>
                  {item.priority}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="mt-8 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
        <p className="text-sm text-yellow-200">
          <strong className="text-yellow-400">Reminder:</strong> As a Guardian, you have access to review 
          flagged content but cannot see users' personal information (phone, email, exact location). 
          If you encounter content that requires admin attention, please escalate it.
        </p>
      </div>
    </div>
  );
}