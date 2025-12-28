"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  Users,
  FileText,
  AlertTriangle,
  Flag,
  Shield,
  Eye,
  TrendingUp,
  Clock,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalPosts: number;
  livePosts: number;
  activeSOS: number;
  flaggedContent: number;
  totalGuardians: number;
  pendingApplications: number;
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentPosts, setRecentPosts] = useState<any[]>([]);
  const [activeSOS, setActiveSOS] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [
        { count: totalUsers },
        { count: activeUsers },
        { count: totalPosts },
        { count: livePosts },
        { count: activeSOS },
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
        supabase.from("posts").select("*, users:user_id(full_name)").order("created_at", { ascending: false }).limit(5),
        supabase.from("sos_alerts").select("*, users:user_id(full_name, avatar_url)").eq("status", "active").order("created_at", { ascending: false }),
      ]);

      setStats({
        totalUsers: totalUsers || 0,
        activeUsers: activeUsers || 0,
        totalPosts: totalPosts || 0,
        livePosts: livePosts || 0,
        activeSOS: activeSOS || 0,
        flaggedContent: flaggedContent || 0,
        totalGuardians: totalGuardians || 0,
        pendingApplications: pendingApplications || 0,
      });

      setRecentPosts(recentPostsData || []);
      setActiveSOS(sosData || []);
    } catch (error) {
      console.error("Error fetching stats:", error);
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

  const statCards = [
    { label: "Total Users", value: stats?.totalUsers || 0, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Active Users", value: stats?.activeUsers || 0, icon: TrendingUp, color: "text-green-400", bg: "bg-green-500/10" },
    { label: "Total Posts", value: stats?.totalPosts || 0, icon: FileText, color: "text-purple-400", bg: "bg-purple-500/10" },
    { label: "Live Posts", value: stats?.livePosts || 0, icon: Eye, color: "text-orange-400", bg: "bg-orange-500/10" },
    { label: "Active SOS", value: stats?.activeSOS || 0, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10" },
    { label: "Flagged Content", value: stats?.flaggedContent || 0, icon: Flag, color: "text-yellow-400", bg: "bg-yellow-500/10" },
    { label: "Guardians", value: stats?.totalGuardians || 0, icon: Shield, color: "text-primary-400", bg: "bg-primary-500/10" },
    { label: "Pending Apps", value: stats?.pendingApplications || 0, icon: Clock, color: "text-cyan-400", bg: "bg-cyan-500/10" },
  ];

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-dark-100">Dashboard Overview</h1>
        <p className="text-dark-400 mt-1">Welcome to Peja Admin</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="glass-card">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-xl ${stat.bg}`}>
                  <Icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-dark-100">{stat.value}</p>
                  <p className="text-sm text-dark-400">{stat.label}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Active SOS Alerts */}
        <div className="glass-card">
          <h2 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Active SOS Alerts
          </h2>
          {activeSOS.length === 0 ? (
            <p className="text-dark-400 text-center py-8">No active SOS alerts</p>
          ) : (
            <div className="space-y-3">
              {activeSOS.map((sos) => (
                <div key={sos.id} className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 overflow-hidden">
                    {sos.users?.avatar_url ? (
                      <img src={sos.users.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-dark-100 truncate">
                      {sos.users?.full_name || "Unknown User"}
                    </p>
                    <p className="text-xs text-dark-400 truncate">{sos.address || "No address"}</p>
                  </div>
                  <span className="text-xs text-dark-500">
                    {formatDistanceToNow(new Date(sos.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Posts */}
        <div className="glass-card">
          <h2 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary-400" />
            Recent Posts
          </h2>
          {recentPosts.length === 0 ? (
            <p className="text-dark-400 text-center py-8">No posts yet</p>
          ) : (
            <div className="space-y-3">
              {recentPosts.map((post) => (
                <div key={post.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                  <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-primary-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-dark-100 truncate capitalize">
                      {post.category?.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-dark-400 truncate">
                      by {post.users?.full_name || "Anonymous"}
                    </p>
                  </div>
                  <span className="text-xs text-dark-500">
                    {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}