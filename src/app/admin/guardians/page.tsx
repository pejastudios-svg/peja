"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { Loader2, Shield, CheckCircle, XCircle, User, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";

type Application = {
  id: string;
  user_id: string;
  motivation: string;
  hours_per_week: string;
  areas_of_expertise: string[] | null;
  experience: string | null;
  status: string | null;
  created_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;

  user?: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
    occupation: string | null;
    status: string | null;
    last_address: string | null;
    last_location_updated_at: string | null;
    is_guardian?: boolean | null;
  };
};

type GuardianUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string | null;
};

function statusPill(status: string) {
  const s = status.toLowerCase();
  if (s === "approved") return "bg-green-500/15 text-green-300 border border-green-500/30";
  if (s === "rejected") return "bg-red-500/15 text-red-300 border border-red-500/30";
  return "bg-yellow-500/15 text-yellow-300 border border-yellow-500/30";
}

export default function AdminGuardiansPage() {
  useScrollRestore("admin:guardians");
  const router = useRouter();
  const sp = useSearchParams();
  const openAppId = sp.get("app");

  const [tab, setTab] = useState<"applications" | "guardians">("applications");

  // Applications
  const [appFilter, setAppFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [items, setItems] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Application | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Active guardians
  const [guardians, setGuardians] = useState<GuardianUser[]>([]);
  const [guardiansLoading, setGuardiansLoading] = useState(false);
  const [guardianSearch, setGuardianSearch] = useState("");

    // Revoke guardian confirm modal + toast
  const [revokeModalOpen, setRevokeModalOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<GuardianUser | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Prevent “auto-open on filter click” bug
  const handledAppParamRef = useRef(false);
  
function GuardianAppRowSkeleton() {
  return (
    <div className="glass-card">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-full shrink-0" />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-3 w-56 mb-2" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
    </div>
  );
}

function GuardianUserRowSkeleton() {
  return (
    <div className="glass-card flex items-center justify-between gap-4">
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

  const fetchApps = async () => {
    setLoading(true);
    try {
      let appsQuery = supabase
        .from("guardian_applications")
        .select("id,user_id,motivation,hours_per_week,areas_of_expertise,experience,status,reviewed_by,reviewed_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (appFilter === "pending") {
        appsQuery = appsQuery.or("status.eq.pending,status.is.null");
      } else if (appFilter === "approved") {
        appsQuery = appsQuery.eq("status", "approved");
      } else if (appFilter === "rejected") {
        appsQuery = appsQuery.eq("status", "rejected");
      } // all -> no filter

      const { data: apps, error } = await appsQuery;
      if (error) throw error;

      const rows = (apps || []) as any[];
      const userIds = Array.from(new Set(rows.map((a) => a.user_id).filter(Boolean)));

      const { data: usersData, error: usersErr } = userIds.length
        ? await supabase
            .from("users")
            .select("id,full_name,email,phone,avatar_url,occupation,status,last_address,last_location_updated_at,is_guardian")
            .in("id", userIds)
        : { data: [], error: null };

      if (usersErr) console.error(usersErr);

      const usersMap: Record<string, any> = {};
      (usersData || []).forEach((u: any) => (usersMap[u.id] = u));

      const merged: Application[] = rows.map((a: any) => ({
        ...a,
        status: a.status || "pending",
        user: usersMap[a.user_id] || undefined,
      }));

      setItems(merged);
    } catch (e) {
      console.error("Admin guardians fetch error:", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchGuardians = async () => {
    setGuardiansLoading(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id,full_name,email,phone,avatar_url,status")
        .eq("is_guardian", true)
        .order("full_name", { ascending: true })
        .limit(500);

      if (error) throw error;
      setGuardians((data || []) as any);
    } catch (e) {
      console.error("fetchGuardians error:", e);
      setGuardians([]);
    } finally {
      setGuardiansLoading(false);
    }
  };

  // Load both lists initially
  useEffect(() => {
    fetchApps();
    fetchGuardians();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
  let t1: any = null;
  let t2: any = null;

  const scheduleApps = () => {
    if (t1) clearTimeout(t1);
    t1 = setTimeout(() => fetchApps(), 500);
  };

  const scheduleGuardians = () => {
    if (t2) clearTimeout(t2);
    t2 = setTimeout(() => fetchGuardians(), 500);
  };

  const ch1 = supabase
    .channel("admin-guardian-apps-rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "guardian_applications" }, scheduleApps)
    .subscribe();

  const ch2 = supabase
    .channel("admin-guardians-rt")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "users" }, scheduleGuardians)
    .subscribe();

  return () => {
    if (t1) clearTimeout(t1);
    if (t2) clearTimeout(t2);
    supabase.removeChannel(ch1);
    supabase.removeChannel(ch2);
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  // Refetch apps when filter changes
  useEffect(() => {
    if (tab === "applications") fetchApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appFilter, tab]);

  // Auto-open application from notification ONLY ONCE, then clear URL param
  useEffect(() => {
    if (!openAppId) return;
    if (handledAppParamRef.current) return;
    if (items.length === 0) return;

    const match = items.find((x) => x.id === openAppId);
    if (match) {
      handledAppParamRef.current = true;
      setSelected(match);
      setModalOpen(true);

      // remove query param so clicking filters doesn’t reopen it
      router.replace("/admin/guardians");
    }
  }, [openAppId, items, router]);

  const handleDecision = async (action: "approve" | "reject") => {
    if (!selected) return;
    setActionLoading(true);

    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const res = await fetch("/api/admin/review-guardian-application", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ applicationId: selected.id, action }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

      setModalOpen(false);
      setSelected(null);

      await fetchApps();
      await fetchGuardians();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Failed");
    } finally {
      setActionLoading(false);
    }
  };

  const deleteApplication = async () => {
    if (!selected) return;
    if (!confirm("Delete this application permanently?")) return;

    setActionLoading(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const res = await fetch("/api/admin/delete-guardian-application", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ applicationId: selected.id }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

      setModalOpen(false);
      setSelected(null);
      await fetchApps();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Failed to delete");
    } finally {
      setActionLoading(false);
    }
  };

   const openRevokeGuardian = (g: GuardianUser) => {
    setRevokeTarget(g);
    setRevokeModalOpen(true);
  };

  const confirmRevokeGuardian = async () => {
    if (!revokeTarget?.id) return;

    setActionLoading(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const res = await fetch("/api/admin/set-user-role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: revokeTarget.id, role: "guardian", value: false }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

      // Close modal
      setRevokeModalOpen(false);
      setRevokeTarget(null);

      // Refresh guardians list
      await fetchGuardians();

      // ✅ in-app toast
      setToast(`Guardian access removed: ${json.user?.full_name || "User"} ✓`);
      setTimeout(() => setToast(null), 2500);
    } catch (e: any) {
      console.error(e);
      setToast(e?.message || "Failed to remove guardian");
      setTimeout(() => setToast(null), 3000);
    } finally {
      setActionLoading(false);
    }
  };

  const filteredGuardians = useMemo(() => {
    const q = guardianSearch.trim().toLowerCase();
    if (!q) return guardians;

    return guardians.filter((g) => {
      const s = `${g.full_name || ""} ${g.email || ""} ${g.phone || ""}`.toLowerCase();
      return s.includes(q);
    });
  }, [guardians, guardianSearch]);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-dark-100 flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary-400" />
            Guardians
          </h1>
          <p className="text-dark-400 mt-1">Applications and active guardians</p>
        </div>

        <Button
          variant="secondary"
          onClick={() => {
            fetchApps();
            fetchGuardians();
          }}
        >
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setTab("applications")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            tab === "applications" ? "bg-primary-600 text-white" : "glass-sm text-dark-300 hover:bg-white/10"
          }`}
        >
          Applications
        </button>
        <button
          onClick={() => setTab("guardians")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            tab === "guardians" ? "bg-primary-600 text-white" : "glass-sm text-dark-300 hover:bg-white/10"
          }`}
        >
          Active Guardians
        </button>
      </div>

      {tab === "applications" && (
        <>
          {/* Filter */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {(["pending", "approved", "rejected", "all"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setAppFilter(k)}
                className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                  appFilter === k ? "bg-primary-600 text-white" : "glass-sm text-dark-300 hover:bg-white/10"
                }`}
              >
                {k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>

         {loading && items.length === 0 ? (
  <div className="space-y-3">
    {Array.from({ length: 8 }).map((_, i) => (
      <GuardianAppRowSkeleton key={i} />
    ))}
  </div>
) : items.length === 0 ? (
  <div className="glass-card text-center py-10">
    <p className="text-dark-400">No applications</p>
  </div>
) : (
  <div className="space-y-3">
    {loading && (
      <div className="flex justify-center py-2">
        <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
      </div>
    )}
    {items.map((a) => {
                const s = (a.status || "pending").toLowerCase();
                return (
                  <div
                    key={a.id}
                    onClick={() => {
                      setSelected(a);
                      setModalOpen(true);
                    }}
                    className="glass-card cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-dark-800 border border-white/10 flex items-center justify-center shrink-0">
                        {a.user?.avatar_url ? (
                          <img src={a.user.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-6 h-6 text-dark-400" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-dark-100 truncate">
                          {a.user?.full_name || "Unknown user"}
                        </p>
                        <p className="text-xs text-dark-500 truncate">
                          {a.user?.email || ""} {a.user?.phone ? `• ${a.user.phone}` : ""}
                        </p>
                        <p className="text-xs text-dark-400 mt-1 truncate">
                          {a.created_at ? formatDistanceToNow(new Date(a.created_at), { addSuffix: true }) : ""}
                        </p>
                      </div>

                      <span className={`px-2 py-0.5 rounded-full text-xs border ${statusPill(s)}`}>
                        {s}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "guardians" && (
        <>
          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400">
                <Search className="w-5 h-5" />
              </div>
              <input
                value={guardianSearch}
                onChange={(e) => setGuardianSearch(e.target.value)}
                placeholder="Search guardians by name, email, phone..."
                className="glass-input w-full h-11 pl-12 pr-4"
              />
            </div>
          </div>

          {guardiansLoading && guardians.length === 0 ? (
  <div className="space-y-3">
    {Array.from({ length: 10 }).map((_, i) => (
      <GuardianUserRowSkeleton key={i} />
    ))}
  </div>
) : filteredGuardians.length === 0 ? (
  <div className="glass-card text-center py-10">
    <p className="text-dark-400">No active guardians</p>
  </div>
) : (
  <div className="space-y-3">
    {guardiansLoading && (
      <div className="flex justify-center py-2">
        <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
      </div>
    )}
    {filteredGuardians.map((g) => (
                <div key={g.id} className="glass-card flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (!g.avatar_url) return;
                        setLightboxUrl(g.avatar_url);
                        setLightboxOpen(true);
                      }}
                      className="w-12 h-12 rounded-full overflow-hidden bg-dark-800 border border-white/10 shrink-0"
                    >
                      {g.avatar_url ? (
                        <img src={g.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <User className="w-6 h-6 text-dark-400" />
                        </div>
                      )}
                    </button>

                    <div className="min-w-0">
                      <p className="text-dark-100 font-medium truncate">{g.full_name || "Unknown"}</p>
                      <p className="text-xs text-dark-500 truncate">
                        {g.email || ""} {g.phone ? `• ${g.phone}` : ""}
                      </p>
                    </div>
                  </div>

                  <Button
                  variant="danger"
                  size="sm"
                  onClick={() => openRevokeGuardian(g)}
                  >
  Remove
</Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Application Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelected(null);
        }}
        title="Guardian Application"
        size="xl"
      >
        {selected && (
          <div className="space-y-4">
            {/* Applicant */}
            <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  if (!selected.user?.avatar_url) return;
                  setLightboxUrl(selected.user.avatar_url);
                  setLightboxOpen(true);
                }}
                className="w-16 h-16 rounded-full overflow-hidden border border-white/10 bg-dark-800 shrink-0"
              >
                {selected.user?.avatar_url ? (
                  <img src={selected.user.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User className="w-8 h-8 text-dark-400" />
                  </div>
                )}
              </button>

              <div className="min-w-0">
                <p className="text-lg font-bold text-dark-100 truncate">
                  {selected.user?.full_name || "Unknown"}
                </p>
                <p className="text-sm text-dark-400 truncate">{selected.user?.email || ""}</p>
                {selected.user?.phone && <p className="text-sm text-dark-400">{selected.user.phone}</p>}
                {selected.user?.occupation && <p className="text-xs text-dark-500 mt-1">{selected.user.occupation}</p>}
                {selected.user?.last_address && (
                  <p className="text-xs text-dark-500 mt-1">
                    Last location: {selected.user.last_address}
                  </p>
                )}
              </div>

              <span className={`ml-auto px-2 py-0.5 rounded-full text-xs border ${statusPill(selected.status || "pending")}`}>
                {(selected.status || "pending").toLowerCase()}
              </span>
            </div>

            {/* Application */}
            <div className="glass-sm rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs text-dark-500">Hours per week</p>
                <p className="text-dark-100">{selected.hours_per_week}</p>
              </div>

              <div>
                <p className="text-xs text-dark-500">Areas of expertise</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {(selected.areas_of_expertise || []).map((x) => (
                    <span key={x} className="px-2 py-1 rounded-lg text-xs bg-primary-600/15 text-primary-300">
                      {x}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-dark-500 mb-1">Motivation</p>
                <p className="text-dark-100 whitespace-pre-wrap">{selected.motivation}</p>
              </div>

              {selected.experience && (
                <div>
                  <p className="text-xs text-dark-500 mb-1">Experience</p>
                  <p className="text-dark-100 whitespace-pre-wrap">{selected.experience}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="pt-2 border-t border-white/10 flex flex-wrap gap-2 justify-between">
              <Button variant="secondary" size="sm" onClick={deleteApplication} disabled={actionLoading}>
                Delete Application
              </Button>

              {(selected.status === "pending" || !selected.status) && (
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    disabled={actionLoading}
                    onClick={() => handleDecision("approve")}
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Approve
                  </Button>

                  <Button variant="danger" size="sm" disabled={actionLoading} onClick={() => handleDecision("reject")}>
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                </div>
              )}
            </div>
                  {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[20000] px-4 py-2 rounded-xl glass-float text-dark-100">
          {toast}
        </div>
      )}
          </div>
        )}
      </Modal>

      <ImageLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        imageUrl={lightboxUrl}
        caption={selected?.user?.full_name || null}
      />
            {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[30000] px-4 py-2 rounded-xl glass-float text-dark-100">
          {toast}
        </div>
      )}
            {/* Revoke Guardian Confirm Modal */}
      <Modal
        isOpen={revokeModalOpen}
        onClose={() => {
          setRevokeModalOpen(false);
          setRevokeTarget(null);
        }}
        title="Remove Guardian Access"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-dark-300">
            Remove Guardian access for{" "}
            <span className="text-dark-100 font-semibold">
              {revokeTarget?.full_name || "this user"}
            </span>
            ?
          </p>

          <p className="text-xs text-dark-500">
            They will immediately lose access to the Guardian Hub. A notification will be sent to them.
          </p>

          <div className="flex gap-2 pt-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setRevokeModalOpen(false);
                setRevokeTarget(null);
              }}
              disabled={actionLoading}
            >
              Cancel
            </Button>

            <Button
              variant="danger"
              className="flex-1"
              onClick={confirmRevokeGuardian}
              isLoading={actionLoading}
            >
              Remove
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}