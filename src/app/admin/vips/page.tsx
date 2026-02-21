"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { apiUrl } from "@/lib/api";
import {
  Search,
  Crown,
  User,
  Shield,
  ShieldCheck,
  Loader2,
  Plus,
  X,
  Star,
  CheckCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import HudShell from "@/components/dashboard/HudShell";

type VIPUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string | null;
  is_vip: boolean;
  is_guardian: boolean | null;
  is_admin: boolean | null;
  created_at: string | null;
};

type SearchUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_vip: boolean;
  is_guardian: boolean | null;
  is_admin: boolean | null;
  status: string | null;
};

function VIPRowSkeleton() {
  return (
    <div className="hud-panel p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <Skeleton className="h-12 w-12 rounded-full shrink-0" />
        <div className="min-w-0">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <Skeleton className="h-8 w-20 rounded-lg" />
    </div>
  );
}

export default function AdminVIPsPage() {
  useScrollRestore("admin:vips");
  const router = useRouter();

  // VIP list
  const [vips, setVips] = useState<VIPUser[]>([]);
  const [vipsLoading, setVipsLoading] = useState(true);
  const [vipSearch, setVipSearch] = useState("");

  // Add VIP modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTimer, setSearchTimer] = useState<NodeJS.Timeout | null>(null);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Revoke confirm modal
  const [revokeModalOpen, setRevokeModalOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<VIPUser | null>(null);

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // =====================================================
  // FETCH VIPs
  // =====================================================
  const fetchVIPs = async () => {
    setVipsLoading(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email, phone, avatar_url, status, is_vip, is_guardian, is_admin, created_at")
        .eq("is_vip", true)
        .order("full_name", { ascending: true })
        .limit(500);

      if (error) throw error;
      setVips((data || []) as VIPUser[]);
    } catch (e) {
      console.error("fetchVIPs error:", e);
      setVips([]);
    } finally {
      setVipsLoading(false);
    }
  };

  useEffect(() => {
    fetchVIPs();
  }, []);

  // Realtime updates
  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;

    const channel = supabase
      .channel("admin-vips-rt")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "users" },
        () => {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => fetchVIPs(), 500);
        }
      )
      .subscribe();

    return () => {
      if (timeout) clearTimeout(timeout);
      supabase.removeChannel(channel);
    };
  }, []);

  // =====================================================
  // SEARCH USERS (for add modal)
  // =====================================================
  const handleSearch = (query: string) => {
    setSearchQuery(query);

    if (searchTimer) clearTimeout(searchTimer);

    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const q = query.trim().toLowerCase();

        const { data, error } = await supabase
          .from("users")
          .select("id, full_name, email, phone, avatar_url, is_vip, is_guardian, is_admin, status")
          .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
          .eq("status", "active")
          .order("full_name", { ascending: true })
          .limit(20);

        if (error) throw error;
        setSearchResults((data || []) as SearchUser[]);
      } catch (e) {
        console.error("Search error:", e);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    setSearchTimer(timer);
  };

  // =====================================================
  // GRANT VIP
  // =====================================================
  const grantVIP = async (userId: string, userName: string) => {
    setActionLoading(userId);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");

      const res = await fetch(apiUrl("/api/admin/set-vip-status"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, value: true }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

      // Update search results to reflect change
      setSearchResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_vip: true } : u))
      );

      await fetchVIPs();
      showToast(`✓ VIP granted to ${userName}`);
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || "Failed to grant VIP");
    } finally {
      setActionLoading(null);
    }
  };

  // =====================================================
  // REVOKE VIP
  // =====================================================
  const openRevokeVIP = (u: VIPUser) => {
    setRevokeTarget(u);
    setRevokeModalOpen(true);
  };

  const confirmRevokeVIP = async () => {
    if (!revokeTarget?.id) return;

    setActionLoading(revokeTarget.id);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");

      const res = await fetch(apiUrl("/api/admin/set-vip-status"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: revokeTarget.id, value: false }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

      setRevokeModalOpen(false);
      setRevokeTarget(null);

      await fetchVIPs();
      showToast(`✓ VIP revoked from ${revokeTarget.full_name || "User"}`);
    } catch (e: any) {
      console.error(e);
      showToast(e?.message || "Failed to revoke VIP");
    } finally {
      setActionLoading(null);
    }
  };

  // =====================================================
  // FILTERED VIPs
  // =====================================================
  const filteredVips = useMemo(() => {
    const q = vipSearch.trim().toLowerCase();
    if (!q) return vips;
    return vips.filter((v) => {
      const s = `${v.full_name || ""} ${v.email || ""} ${v.phone || ""}`.toLowerCase();
      return s.includes(q);
    });
  }, [vips, vipSearch]);

  // =====================================================
  // ROLE BADGE HELPER
  // =====================================================
  const roleBadge = (u: { is_admin?: boolean | null; is_guardian?: boolean | null }) => {
    if (u.is_admin) return <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">Admin</span>;
    if (u.is_guardian) return <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">Guardian</span>;
    return null;
  };

  return (
    <HudShell
      title="VIP Management"
      subtitle="Grant exclusive DM access to selected users"
      right={
        <button
          onClick={() => {
            setAddModalOpen(true);
            setSearchQuery("");
            setSearchResults([]);
          }}
          className="btn-glow px-5 py-2.5 rounded-xl text-white font-medium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add VIP
        </button>
      }
    >
      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="hud-panel p-4 text-center">
          <p className="text-3xl font-bold text-primary-400">{vips.length}</p>
          <p className="text-xs text-dark-500 uppercase tracking-wider mt-1">Total VIPs</p>
        </div>
        <div className="hud-panel p-4 text-center">
          <p className="text-3xl font-bold text-green-400">
            {vips.filter((v) => v.status === "active").length}
          </p>
          <p className="text-xs text-dark-500 uppercase tracking-wider mt-1">Active</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
        <input
          value={vipSearch}
          onChange={(e) => setVipSearch(e.target.value)}
          placeholder="Search VIPs..."
          className="w-full h-11 pl-10 pr-4 bg-[#1E1B24] border border-white/10 rounded-xl text-sm focus:outline-none focus:border-primary-500/50 focus:shadow-[0_0_15px_rgba(124,58,237,0.15)] transition-all"
        />
      </div>

      {/* VIP List */}
      <div className="space-y-2">
        {vipsLoading && vips.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => <VIPRowSkeleton key={i} />)
        ) : filteredVips.length === 0 ? (
          <div className="text-center py-16">
            <Crown className="w-12 h-12 text-dark-600 mx-auto mb-3" />
            <p className="text-dark-400 text-lg font-medium">
              {vipSearch ? "No VIPs match your search" : "No VIPs yet"}
            </p>
            <p className="text-dark-500 text-sm mt-1">
              {!vipSearch && 'Click "Add VIP" to grant someone access'}
            </p>
          </div>
        ) : (
          filteredVips.map((v) => (
            <div
              key={v.id}
              className="hud-panel p-4 flex items-center justify-between gap-4 group hover:border-primary-500/30 transition-all"
            >
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    if (!v.avatar_url) return;
                    setLightboxUrl(v.avatar_url);
                    setLightboxOpen(true);
                  }}
                  className="relative w-12 h-12 rounded-full overflow-hidden bg-dark-800 border-2 border-primary-500/40 shrink-0"
                >
                  {v.avatar_url ? (
                    <img src={v.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-6 h-6 text-dark-400" />
                    </div>
                  )}
                  {/* VIP crown indicator */}
                  <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center border-2 border-[#120a1e]">
                    <Crown className="w-3 h-3 text-yellow-300" />
                  </div>
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-dark-100 font-semibold truncate">
                      {v.full_name || "Unknown"}
                    </p>
                    {roleBadge(v)}
                  </div>
                  <p className="text-xs text-dark-500 truncate">
                    {v.email || ""}{v.phone ? ` • ${v.phone}` : ""}
                  </p>
                  {v.created_at && (
                    <p className="text-xs text-dark-600 mt-0.5">
                      Joined {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                                    onClick={() => router.push(`/admin/users/${v.id}`)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-dark-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  View
                </button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => openRevokeVIP(v)}
                  className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                >
                  Revoke
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* =====================================================
          ADD VIP MODAL
          ===================================================== */}
      <Modal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Grant VIP Access"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-dark-400">
            Search for a user to grant VIP status. VIPs get access to direct messaging and a special badge.
          </p>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by name, email, or phone..."
              className="w-full h-11 pl-10 pr-4 bg-[#1E1B24] border border-white/10 rounded-xl text-sm focus:outline-none focus:border-primary-500/50 transition-all"
              autoFocus
            />
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-white/10">
            {searchLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
                <span className="ml-2 text-sm text-dark-400">Searching...</span>
              </div>
            ) : searchQuery.trim().length < 2 ? (
              <div className="text-center py-8">
                <Search className="w-8 h-8 text-dark-600 mx-auto mb-2" />
                <p className="text-sm text-dark-500">Type at least 2 characters to search</p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-8">
                <User className="w-8 h-8 text-dark-600 mx-auto mb-2" />
                <p className="text-sm text-dark-500">No users found</p>
              </div>
            ) : (
              searchResults.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-dark-800 border border-white/10 shrink-0 flex items-center justify-center">
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-5 h-5 text-dark-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-dark-100 truncate">
                          {u.full_name || "Unknown"}
                        </p>
                        {u.is_vip && (
                          <span className="flex items-center gap-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-primary-500/15 text-primary-300 border border-primary-500/30">
                            <Crown className="w-3 h-3" />
                            VIP
                          </span>
                        )}
                        {roleBadge(u)}
                      </div>
                      <p className="text-xs text-dark-500 truncate">
                        {u.email || ""}{u.phone ? ` • ${u.phone}` : ""}
                      </p>
                    </div>
                  </div>

                  {u.is_vip ? (
                    <span className="text-xs text-primary-400 font-medium shrink-0 flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" />
                      VIP
                    </span>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => grantVIP(u.id, u.full_name || "User")}
                      isLoading={actionLoading === u.id}
                      disabled={actionLoading !== null}
                    >
                      <Crown className="w-3.5 h-3.5 mr-1" />
                      Grant
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* =====================================================
          REVOKE CONFIRM MODAL
          ===================================================== */}
      <Modal
        isOpen={revokeModalOpen}
        onClose={() => setRevokeModalOpen(false)}
        title="Revoke VIP Access"
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-dark-800 border border-white/10 shrink-0">
              {revokeTarget?.avatar_url ? (
                <img src={revokeTarget.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User className="w-6 h-6 text-dark-400" />
                </div>
              )}
            </div>
            <div>
              <p className="text-dark-100 font-semibold">{revokeTarget?.full_name || "Unknown"}</p>
              <p className="text-xs text-dark-500">{revokeTarget?.email}</p>
            </div>
          </div>

          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-sm text-red-300">
              This will remove their VIP badge and DM access. Their existing conversations will be preserved but they won't be able to send new messages.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              className="flex-1"
              variant="secondary"
              onClick={() => {
                setRevokeModalOpen(false);
                setRevokeTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              variant="danger"
              onClick={confirmRevokeVIP}
              isLoading={actionLoading === revokeTarget?.id}
            >
              Revoke VIP
            </Button>
          </div>
        </div>
      </Modal>

      {/* Lightbox */}
      <ImageLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        imageUrl={lightboxUrl}
        caption={null}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full bg-dark-900 border border-white/10 shadow-2xl text-white font-medium animate-in fade-in slide-in-from-top-4">
          {toast}
        </div>
      )}
    </HudShell>
  );
}