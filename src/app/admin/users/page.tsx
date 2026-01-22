"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Search, Phone, Mail, Shield, Ban, CheckCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";
import { ChevronDown } from "lucide-react";

interface AdminUser {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  occupation: string | null;
  status: "active" | "suspended" | "banned" | null;
  is_guardian: boolean | null;
  is_admin: boolean | null;
  created_at: string;
}

export default function AdminUsersPage() {
  useScrollRestore("admin:users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended" | "banned">("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { session } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetchUsers();
  }, [statusFilter]);

  function AdminUserRowSkeleton() {
  return (
    <div className="glass-card flex items-center justify-between gap-3">
      <div className="flex-1">
        <Skeleton className="h-4 w-40 mb-2" />
        <Skeleton className="h-3 w-56 mb-1" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-lg" />
      </div>
    </div>
  );
}

  const fetchUsers = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("users")
        .select("id, full_name, email, phone, avatar_url, occupation, status, is_guardian, is_admin, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error("Error fetching users:", err);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
  let t: any = null;

  const schedule = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fetchUsers(), 500);
  };

  const ch = supabase
    .channel("admin-users-rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "users" }, schedule)
    .subscribe();

  return () => {
    if (t) clearTimeout(t);
    supabase.removeChannel(ch);
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [statusFilter]);

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q)
    );
  });

 const updateStatus = async (userId: string, newStatus: "active" | "suspended" | "banned") => {
  setActionLoading(userId);

  try {
    if (!session?.access_token) {
      throw new Error("No session token. Please sign in again.");
    }

    const res = await fetch("/api/admin/set-user-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId, status: newStatus }),
    });

const text = await res.text();
let json: any;
try {
  json = JSON.parse(text);
} catch {
  console.error("API returned non-JSON:", text.slice(0, 300));
  throw new Error("API crashed (non-JSON). Check terminal logs + service role env.");
}
    console.log("set-user-status response:", res.status, json);
    if (!res.ok || !json.ok) {
      throw new Error(json.error || `Request failed (${res.status})`);
    }

  await fetchUsers();
  } catch (err) {
    console.error("Status update error:", err);
    alert("Failed to update user status");
  } finally {
    setActionLoading(null);
  }
};

  return (
    <HudShell
      title="User Registry"
      subtitle="Manage accounts, permissions, and status"
      right={
        <div className="flex items-center gap-2">
          <span className="pill pill-purple">{filteredUsers.length} Users</span>
          <GlowButton onClick={fetchUsers}>Refresh</GlowButton>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Filters Row */}
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <button
              type="button"
              onClick={() => searchInputRef.current?.focus()}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-primary-400 transition-colors z-10"
            >
              <Search className="w-4 h-4" />
            </button>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or phone..."
              className="w-full h-11 pl-10 pr-4 bg-[#1E1B24] border border-white/10 rounded-xl text-sm text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-primary-500/50 focus:shadow-[0_0_15px_rgba(124,58,237,0.15)] transition-all"
            />
          </div>

          {/* Custom Dropdown Wrapper */}
          <div className="relative md:w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full h-11 pl-4 pr-10 bg-[#1E1B24] border border-white/10 rounded-xl text-sm text-dark-200 focus:outline-none focus:border-primary-500/50 focus:shadow-[0_0_15px_rgba(124,58,237,0.15)] appearance-none transition-all cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="banned">Banned</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500 pointer-events-none" />
          </div>
        </div>

        {/* Users List */}
        <HudPanel className="min-h-[400px]">
          {loading && users.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <AdminUserRowSkeleton key={i} />
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12 text-dark-400">No users found</div>
          ) : (
            <div className="space-y-2">
              {loading && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                </div>
              )}
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  onClick={() => router.push(`/admin/users/${user.id}`)}
                  className="group flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all cursor-pointer hover:shadow-lg hover:shadow-black/20"
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-[#1E1B24] border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                        {user.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                        <span className="text-dark-500 font-bold text-sm">{user.full_name?.[0] || "U"}</span>
                        )}
                    </div>

                    <div>
                        <div className="flex items-center gap-2">
                        <p className="font-semibold text-dark-100 text-sm">
                            {user.full_name || "Unnamed User"}
                        </p>
                        {/* Centered Badges */}
                        {user.is_admin && (
                            <span className="inline-flex items-center justify-center px-2 h-5 rounded-md bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px] font-bold uppercase tracking-wider">
                            Admin
                            </span>
                        )}
                        {!user.is_admin && user.is_guardian && (
                            <span className="inline-flex items-center justify-center px-2 h-5 rounded-md bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px] font-bold uppercase tracking-wider">
                            Guardian
                            </span>
                        )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-dark-400 mt-0.5">
                        {user.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {user.email}</span>}
                        {user.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {user.phone}</span>}
                        </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pl-13 md:pl-0">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium uppercase tracking-wide border ${
                        user.status === "active"
                          ? "bg-green-500/10 text-green-400 border-green-500/20"
                          : user.status === "suspended"
                          ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                          : "bg-red-500/10 text-red-400 border-red-500/20"
                      }`}
                    >
                      {user.status || "unknown"}
                    </span>

                    {/* Quick Actions */}
                    <div className="flex gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                      {user.status !== "active" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); updateStatus(user.id, "active"); }}
                          className="p-1.5 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
                          title="Activate"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {user.status !== "suspended" && (
                         <button
                           onClick={(e) => { e.stopPropagation(); updateStatus(user.id, "suspended"); }}
                           className="p-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors"
                           title="Suspend"
                         >
                           <Ban className="w-3.5 h-3.5" />
                         </button>
                      )}
                      {user.status !== "banned" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); updateStatus(user.id, "banned"); }}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                          title="Ban"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </HudPanel>
      </div>
    </HudShell>
  );
}