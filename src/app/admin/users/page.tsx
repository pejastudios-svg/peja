"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Search, Phone, Mail, Shield, Ban, CheckCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";

interface AdminUser {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
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
        .select("id, full_name, email, phone, occupation, status, is_guardian, is_admin, created_at")
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
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-100">Users</h1>
        <p className="text-dark-400 mt-1">View and manage Peja users</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="relative flex-1 min-w-[280px]">
         <button
  type="button"
  onClick={() => searchInputRef.current?.focus()}
  className="absolute left-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10 z-10"
  aria-label="Focus search"
>
  <Search className="w-5 h-5 text-dark-400" />
</button>

<input
  ref={searchInputRef}
  type="text"
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  placeholder="Search by name, email, or phone..."
  className="glass-input w-full h-11 pl-12 pr-4"
/>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "suspended" | "banned")}
          className="px-4 py-2.5 glass-input md:w-48"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
        </select>
      </div>

      {/* List */}
      {loading && users.length === 0 ? (
  <div className="space-y-3">
    {Array.from({ length: 10 }).map((_, i) => (
      <AdminUserRowSkeleton key={i} />
    ))}
  </div>
) : filteredUsers.length === 0 ? (
  <div className="glass-card text-center py-12">
    <p className="text-dark-400">No users found</p>
  </div>
) : (
  <div className="space-y-3">
    {loading && (
      <div className="flex justify-center py-2">
        <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
      </div>
    )}
    {filteredUsers.map((user) => (
            <div
            key={user.id}
            onClick={() => router.push(`/admin/users/${user.id}`)}
            className="glass-card flex flex-col md:flex-row md:items-center md:justify-between gap-3 cursor-pointer hover:bg-white/5 transition-colors"
            >
              <div>
                <p className="font-medium text-dark-100">
                  {user.full_name || "Unnamed User"}
                  {user.is_admin && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-red-400">
                      <Shield className="w-3 h-3" /> Admin
                    </span>
                  )}
                  {!user.is_admin && user.is_guardian && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-primary-400">
                      <Shield className="w-3 h-3" /> Guardian
                    </span>
                  )}
                </p>
                <div className="mt-1 space-y-1 text-sm text-dark-400">
                  {user.email && (
                    <div className="flex items-center gap-1">
                      <Mail className="w-3 h-3" /> {user.email}
                    </div>
                  )}
                  {user.phone && (
                    <div className="flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {user.phone}
                    </div>
                  )}
                  {user.occupation && (
                    <div className="text-xs text-dark-500">
                      {user.occupation}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs capitalize ${
                    user.status === "active"
                      ? "bg-green-500/20 text-green-400"
                      : user.status === "suspended"
                      ? "bg-yellow-500/20 text-yellow-400"
                      : user.status === "banned"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-dark-600 text-dark-400"
                  }`}
                >
                  {user.status || "unknown"}
                </span>

                <div className="flex gap-1">
                  {user.status !== "active" && (
                    <button
                      onClick={(e) => {
                      e.stopPropagation();
                      updateStatus(user.id, "active");
                      }}
                      disabled={actionLoading === user.id}
                      className="p-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 text-xs flex items-center gap-1"
                    >
                      <CheckCircle className="w-3 h-3" /> Activate
                    </button>
                  )}
                  {user.status !== "suspended" && (
                    <button
                      onClick={(e) => {
                     e.stopPropagation();
                     updateStatus(user.id, "suspended");
                     }}
                      disabled={actionLoading === user.id}
                      className="p-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 text-xs"
                    >
                      Suspend
                    </button>
                  )}
                  {user.status !== "banned" && (
                    <button
                      onClick={(e) => {
                      e.stopPropagation();
                      updateStatus(user.id, "banned");
                      }}
                      disabled={actionLoading === user.id}
                      className="p-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 text-xs flex items-center gap-1"
                    >
                      <Ban className="w-3 h-3" /> Ban
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}