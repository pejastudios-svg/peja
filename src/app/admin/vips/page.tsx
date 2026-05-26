"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePageCache } from "@/context/PageCacheContext";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { apiUrl } from "@/lib/api";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import {
  Search,
  Crown,
  User,
  Loader2,
  Plus,
  X,
  Star,
  CheckCircle,
  CheckSquare,
  Square,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import HudShell from "@/components/dashboard/HudShell";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

// Combined MVP + VIP management. The original page only handled VIP;
// MVP is the strictly-higher tier (see project_mvp_vip_roles memory
// note). Both flags coexist on the row.
type ElevatedUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string | null;
  is_vip: boolean;
  is_mvp: boolean;
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
  is_mvp: boolean;
  is_guardian: boolean | null;
  is_admin: boolean | null;
  status: string | null;
};

// Legacy alias so the existing skeleton component below keeps
// compiling without a rename.
type VIPUser = ElevatedUser;

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
const pageCache = usePageCache();
  const cachedVips = pageCache.get<VIPUser[]>("admin:vips");

  const [vips, setVips] = useState<VIPUser[]>(cachedVips || []);
  const [vipsLoading, setVipsLoading] = useState(cachedVips === null);
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

  // Bulk selection state. selectMode flips the row UI into checkbox
  // mode and swaps the per-row action buttons for a sticky bottom
  // bulk-action bar. selectedIds is the Set of user ids currently
  // ticked. bulkLoading suppresses the bar's actions while a batch
  // is in flight so admins can't double-fire.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useScrollFreeze(revokeModalOpen);

  // =====================================================
  // FETCH VIPs
  // =====================================================
  const fetchVIPs = async () => {
    setVipsLoading(true);
    try {
      // Pull both tiers in one query — the list now shows every user
      // with is_vip OR is_mvp. Each row's badge + actions branch on
      // which flag(s) the row carries.
      const { data, error } = await supabase
        .from("users")
        .select(
          "id, full_name, email, phone, avatar_url, status, is_vip, is_mvp, is_guardian, is_admin, created_at"
        )
        .or("is_vip.eq.true,is_mvp.eq.true")
        .order("full_name", { ascending: true })
        .limit(500);

      if (error) throw error;
      const list = (data || []) as ElevatedUser[];
      setVips(list);
      pageCache.set("admin:vips", list);
    } catch (e) {
      setVips([]);
    } finally {
      setVipsLoading(false);
    }
  };

useEffect(() => {
    if (cachedVips) {
      setVipsLoading(false);
      fetchVIPs(); // revalidate in background
    } else {
      fetchVIPs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          .select(
            "id, full_name, email, phone, avatar_url, is_vip, is_mvp, is_guardian, is_admin, status"
          )
          .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
          .eq("status", "active")
          .order("full_name", { ascending: true })
          .limit(20);

        if (error) throw error;
        setSearchResults((data || []) as SearchUser[]);
      } catch (e) {
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
 // Generic toggle wrapper used by both VIP and MVP grant/revoke
 // flows. Centralises the optimistic + revert logic so the four
 // permutations don't duplicate code.
 const setElevatedFlag = async (
   userId: string,
   userName: string,
   role: "vip" | "mvp",
   value: boolean
 ) => {
   const endpoint =
     role === "vip" ? "/api/admin/set-vip-status" : "/api/admin/set-mvp-status";
   // Optimistic: flip search-result row + main list row.
   setSearchResults((prev) =>
     prev.map((u) =>
       u.id === userId ? { ...u, [`is_${role}`]: value } : u
     )
   );
   setVips((prev) => {
     const exists = prev.find((v) => v.id === userId);
     if (exists) {
       return prev.map((v) =>
         v.id === userId ? { ...v, [`is_${role}`]: value } : v
       );
     }
     return prev;
   });
   try {
     const { data: auth } = await supabase.auth.getSession();
     const token = auth.session?.access_token;
     if (!token) throw new Error("Session expired");
     const res = await fetch(apiUrl(endpoint), {
       method: "POST",
       headers: {
         "Content-Type": "application/json",
         Authorization: `Bearer ${token}`,
       },
       body: JSON.stringify({ userId, value }),
     });
     const json = await res.json();
     if (!res.ok || !json.ok) throw new Error(json.error || "Failed");
     await fetchVIPs();
     const label = role === "vip" ? "VIP" : "MVP";
     showToast(
       value ? `${label} granted to ${userName}` : `${label} revoked from ${userName}`
     );
   } catch (e: any) {
     // Revert search row.
     setSearchResults((prev) =>
       prev.map((u) =>
         u.id === userId ? { ...u, [`is_${role}`]: !value } : u
       )
     );
     showToast(e?.message || "Action failed");
     // Refetch to reconcile main list against server truth.
     await fetchVIPs();
   } finally {
     setActionLoading(null);
   }
 };

 const grantVIP = async (userId: string, userName: string) => {
    // Optimistic: update search results immediately
    setSearchResults((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, is_vip: true } : u))
    );

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

      await fetchVIPs();
      showToast(`VIP granted to ${userName}`);
    } catch (e: any) {
      // Revert search results
      setSearchResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_vip: false } : u))
      );
      showToast(e?.message || "Failed to grant VIP");
    } finally {
      setActionLoading(null);
    }
  };

  // Thin wrappers so existing call sites that read "grantVIP" /
  // "grantMVP" stay obvious. setElevatedFlag does the heavy lifting.
  const grantMVP = (userId: string, userName: string) =>
    setElevatedFlag(userId, userName, "mvp", true);
  const revokeMVP = (userId: string, userName: string) =>
    setElevatedFlag(userId, userName, "mvp", false);

  // =====================================================
  // BULK SELECTION HELPERS
  // =====================================================
  const toggleSelect = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredVips.map((v) => v.id)));
  };

  // Bulk grant / revoke. Unlike setElevatedFlag's per-user flow, we
  // skip the optimistic search-result patch (search modal isn't open
  // during a bulk op) and refetch ONCE at the end instead of after
  // every individual request. Failures are collected so the toast can
  // report "X succeeded, Y failed" rather than swallowing partials.
  const bulkSetFlag = async (role: "vip" | "mvp", value: boolean) => {
    if (selectedIds.size === 0 || bulkLoading) return;
    setBulkLoading(true);
    const endpoint =
      role === "vip" ? "/api/admin/set-vip-status" : "/api/admin/set-mvp-status";
    const ids = Array.from(selectedIds);

    // Optimistic flip on the main list so the table reflects the
    // intent instantly; the post-batch fetchVIPs() reconciles against
    // server truth.
    setVips((prev) =>
      prev.map((v) =>
        ids.includes(v.id) ? { ...v, [`is_${role}`]: value } : v
      )
    );

    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");

      const results = await Promise.allSettled(
        ids.map((userId) =>
          fetch(apiUrl(endpoint), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ userId, value }),
          }).then(async (res) => {
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.ok) {
              throw new Error(json.error || `HTTP ${res.status}`);
            }
            return userId;
          })
        )
      );

      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = ids.length - failed;
      const label = role === "vip" ? "VIP" : "MVP";
      const verb = value ? "granted" : "revoked";
      if (failed === 0) {
        showToast(`${label} ${verb} for ${succeeded} user${succeeded === 1 ? "" : "s"}`);
      } else if (succeeded === 0) {
        showToast(`Failed to ${verb} ${label} for any user`);
      } else {
        showToast(
          `${label} ${verb} for ${succeeded}, ${failed} failed`
        );
      }
    } catch (e: any) {
      showToast(e?.message || "Bulk action failed");
    } finally {
      // Refetch once so any partial-failure rows reconcile against
      // server truth (the optimistic flip stays for the rows that
      // actually succeeded).
      await fetchVIPs();
      setBulkLoading(false);
      exitSelectMode();
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
    const target = revokeTarget;

    // Optimistic
    setVips((prev) => prev.filter((v) => v.id !== target.id));
    setRevokeModalOpen(false);
    setRevokeTarget(null);
    showToast(`VIP revoked from ${target.full_name || "User"}`);

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
        body: JSON.stringify({ userId: target.id, value: false }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");
    } catch (e: any) {
      // Revert
      setVips((prev) => [...prev, target]);
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
      title="MVP & VIP Management"
      subtitle="Grant elevated tiers. MVPs see MVPs+VIPs; VIPs see only VIPs"
      right={
        selectMode ? (
          // In select mode, the top-right slot becomes Cancel +
          // counter so the admin always sees how many rows they've
          // ticked. Cancel exits without touching anything.
          <div className="flex items-center gap-3">
            <span className="text-sm text-dark-300">
              {selectedIds.size} selected
            </span>
            <button
              onClick={exitSelectMode}
              className="px-4 py-2 rounded-xl text-sm font-medium text-dark-200 hover:bg-white/5 transition-colors flex items-center gap-1.5"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectMode(true)}
              disabled={filteredVips.length === 0}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-dark-200 hover:bg-white/5 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckSquare className="w-4 h-4" />
              Select
            </button>
            <button
              onClick={() => {
                setAddModalOpen(true);
                setSearchQuery("");
                setSearchResults([]);
              }}
              className="btn-glow px-5 py-2.5 rounded-xl text-white font-medium flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add MVP / VIP
            </button>
          </div>
        )
      }
    >
      {/* Stats bar — now split by tier so admins can see at a glance
          who falls where. A single user can carry both flags, so the
          Total cell counts distinct rows (not the sum of MVP+VIP). */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="hud-panel p-4 text-center">
          <p className="text-3xl font-bold text-amber-300">
            {vips.filter((v) => v.is_mvp).length}
          </p>
          <p className="text-xs text-dark-500 uppercase tracking-wider mt-1">MVPs</p>
        </div>
        <div className="hud-panel p-4 text-center">
          <p className="text-3xl font-bold text-primary-400">
            {vips.filter((v) => v.is_vip).length}
          </p>
          <p className="text-xs text-dark-500 uppercase tracking-wider mt-1">VIPs</p>
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

      {/* Select-all bar — only visible in select mode. Lets admins
          tick every filtered row in one click (or untick the same way
          when everything is already selected). */}
      {selectMode && filteredVips.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between">
          <span className="text-sm text-dark-300">
            {selectedIds.size === 0
              ? "Tap a row to select"
              : `${selectedIds.size} of ${filteredVips.length} selected`}
          </span>
          <button
            onClick={() => {
              if (selectedIds.size === filteredVips.length) {
                setSelectedIds(new Set());
              } else {
                selectAllVisible();
              }
            }}
            className="text-sm font-medium text-primary-300 hover:text-primary-200 transition-colors"
          >
            {selectedIds.size === filteredVips.length
              ? "Clear all"
              : "Select all"}
          </button>
        </div>
      )}

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
          filteredVips.map((v) => {
            const isSelected = selectedIds.has(v.id);
            return (
            <div
              key={v.id}
              onClick={selectMode ? () => toggleSelect(v.id) : undefined}
              className={`hud-panel p-4 flex items-center justify-between gap-4 group transition-all ${
                selectMode
                  ? "cursor-pointer " +
                    (isSelected
                      ? "border-primary-500/60 bg-primary-500/5"
                      : "hover:border-primary-500/30")
                  : "hover:border-primary-500/30"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      // In select mode, the row owns the click — don't
                      // pop the lightbox from underneath the toggle.
                      if (selectMode) {
                        e.stopPropagation();
                        toggleSelect(v.id);
                        return;
                      }
                      if (!v.avatar_url) return;
                      setLightboxUrl(v.avatar_url);
                      setLightboxOpen(true);
                    }}
                    className="contents"
                  >
                    <AvatarImage
                      src={v.avatar_url}
                      wrapperClassName="w-12 h-12 rounded-full overflow-hidden bg-dark-800 border-2 border-primary-500/40 flex items-center justify-center"
                      fallbackIconClassName="w-6 h-6"
                    />
                  </button>
                  {/* Selection checkbox (select mode) OR VIP crown
                      indicator (default). They occupy the same slot
                      so the row layout doesn't shift between modes. */}
                  {selectMode ? (
                    <div
                      className={`absolute -top-1.5 -right-1 w-5 h-5 rounded-full flex items-center justify-center border-2 z-10 pointer-events-none transition-colors ${
                        isSelected
                          ? "bg-primary-600 border-primary-300"
                          : "bg-dark-800 border-white/30"
                      }`}
                    >
                      {isSelected ? (
                        <CheckCircle className="w-3 h-3 text-white" />
                      ) : (
                        <Square className="w-3 h-3 text-dark-500" />
                      )}
                    </div>
                  ) : (
                    <div className="absolute -top-1.5 -right-1 w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center border-2 border-[#120a1e] z-10 pointer-events-none">
                      <Crown className="w-3 h-3 text-yellow-300" />
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-dark-100 font-semibold truncate">
                      {v.full_name || "Unknown"}
                    </p>
                    {/* Tier chips. A row can carry MVP, VIP, or both. */}
                    {v.is_mvp && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        <Star className="w-3 h-3" />
                        MVP
                      </span>
                    )}
                    {v.is_vip && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-primary-500/15 text-primary-300 border border-primary-500/30">
                        <Crown className="w-3 h-3" />
                        VIP
                      </span>
                    )}
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

              {/* Per-row action buttons are hidden in select mode —
                  the row's only interaction there is the checkbox.
                  Individual grant/revoke/View come back when select
                  mode exits. */}
              <div
                className={`flex items-center gap-2 shrink-0 flex-wrap justify-end ${
                  selectMode ? "hidden" : ""
                }`}
              >
                <button
                  onClick={() => router.push(`/admin/users/${v.id}`)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-dark-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  View
                </button>
                {/* Promotion / demotion between tiers. Showing the
                    opposite tier as a quick grant button so admins
                    don't have to pop the search modal just to flip
                    someone from VIP → MVP. */}
                {!v.is_mvp && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      grantMVP(v.id, v.full_name || "User")
                    }
                  >
                    <Star className="w-3.5 h-3.5 mr-1" />
                    Make MVP
                  </Button>
                )}
                {!v.is_vip && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setElevatedFlag(v.id, v.full_name || "User", "vip", true)
                    }
                  >
                    <Crown className="w-3.5 h-3.5 mr-1" />
                    Make VIP
                  </Button>
                )}
                {v.is_mvp && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() =>
                      revokeMVP(v.id, v.full_name || "User")
                    }
                    className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                  >
                    Revoke MVP
                  </Button>
                )}
                {v.is_vip && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => openRevokeVIP(v)}
                    className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                  >
                    Revoke VIP
                  </Button>
                )}
              </div>
            </div>
            );
          })
        )}
      </div>

      {/* =====================================================
          BULK ACTION BAR — fixed to the bottom while selectMode
          is on. Mirrors v2 chat's SelectActionBar in spirit:
          shows the count + the four bulk verbs + Cancel. Each
          button is disabled while a batch is in flight so admins
          can't queue two requests on top of one another.
          ===================================================== */}
      {selectMode && (
        <div
          className="fixed left-0 right-0 z-40 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3"
          style={{ bottom: 0 }}
        >
          <div className="max-w-4xl mx-auto rounded-2xl bg-[#1E1B24]/95 backdrop-blur border border-white/15 shadow-2xl p-3 flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-0 text-sm text-dark-200">
              <span className="font-semibold text-white">
                {selectedIds.size}
              </span>{" "}
              {selectedIds.size === 1 ? "user" : "users"} selected
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={bulkLoading || selectedIds.size === 0}
              onClick={() => bulkSetFlag("mvp", true)}
            >
              {bulkLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <Star className="w-3.5 h-3.5 mr-1" />
                  Make MVP
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={bulkLoading || selectedIds.size === 0}
              onClick={() => bulkSetFlag("vip", true)}
            >
              <Crown className="w-3.5 h-3.5 mr-1" />
              Make VIP
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={bulkLoading || selectedIds.size === 0}
              onClick={() => bulkSetFlag("mvp", false)}
            >
              Revoke MVP
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={bulkLoading || selectedIds.size === 0}
              onClick={() => bulkSetFlag("vip", false)}
            >
              Revoke VIP
            </Button>
          </div>
        </div>
      )}

      {/* =====================================================
          ADD VIP MODAL
          ===================================================== */}
      <Modal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Grant MVP / VIP Access"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-dark-400">
            Search for a user, then pick the tier to grant. MVPs see
            both MVPs and VIPs in pickers; VIPs see only other VIPs.
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
                <PejaSpinner className="w-5 h-5" />
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
                    <AvatarImage
                      src={u.avatar_url}
                      wrapperClassName="w-10 h-10 rounded-full overflow-hidden bg-dark-800 border border-white/10 shrink-0 flex items-center justify-center"
                      fallbackIconClassName="w-5 h-5"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-dark-100 truncate">
                          {u.full_name || "Unknown"}
                        </p>
                        {u.is_mvp && (
                          <span className="flex items-center gap-1 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            <Star className="w-3 h-3" />
                            MVP
                          </span>
                        )}
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

                  {/* Two grant buttons side-by-side — admin picks
                      which tier. Already-elevated tiers show a
                      checkmark instead so admins can see at a glance
                      who already has what. */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {u.is_mvp ? (
                      <span className="text-xs text-amber-400 font-medium flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        MVP
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => grantMVP(u.id, u.full_name || "User")}
                        isLoading={actionLoading === u.id}
                        disabled={actionLoading !== null}
                      >
                        <Star className="w-3.5 h-3.5 mr-1" />
                        MVP
                      </Button>
                    )}
                    {u.is_vip ? (
                      <span className="text-xs text-primary-400 font-medium flex items-center gap-1">
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
                        VIP
                      </Button>
                    )}
                  </div>
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
            <AvatarImage
              src={revokeTarget?.avatar_url}
              wrapperClassName="w-12 h-12 rounded-full overflow-hidden bg-dark-800 border border-white/10 shrink-0 flex items-center justify-center"
              fallbackIconClassName="w-6 h-6"
            />
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