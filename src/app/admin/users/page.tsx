"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Loader2, Search, Phone, Mail, Shield, Ban, CheckCircle } from "lucide-react";

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
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended" | "banned">("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, [statusFilter]);

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
      const { error } = await supabase
        .from("users")
        .update({ status: newStatus })
        .eq("id", userId);

      if (error) throw error;

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, status: newStatus } : u))
      );
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
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or phone..."
            className="w-full pl-10 pr-4 py-2.5 glass-input"
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
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="glass-card text-center py-12">
          <p className="text-dark-400">No users found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredUsers.map((user) => (
            <div key={user.id} className="glass-card flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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
                      onClick={() => updateStatus(user.id, "active")}
                      disabled={actionLoading === user.id}
                      className="p-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 text-xs flex items-center gap-1"
                    >
                      <CheckCircle className="w-3 h-3" /> Activate
                    </button>
                  )}
                  {user.status !== "suspended" && (
                    <button
                      onClick={() => updateStatus(user.id, "suspended")}
                      disabled={actionLoading === user.id}
                      className="p-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 text-xs"
                    >
                      Suspend
                    </button>
                  )}
                  {user.status !== "banned" && (
                    <button
                      onClick={() => updateStatus(user.id, "banned")}
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