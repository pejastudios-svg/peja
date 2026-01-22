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
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";

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
          <Skeleton className="h-4 w-32 max-w-full mb-2" />
          <Skeleton className="h-3 w-full max-w-[180px] mb-2" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full shrink-0" />
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
    <HudShell
      title="Guardian Network"
      subtitle="Moderation force and application management"
      right={
         <div className="flex bg-[#121016] p-1.5 rounded-xl border border-white/10 gap-1">
            <button
               onClick={() => setTab("applications")}
               className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  tab === "applications" 
                  ? "bg-primary-600 text-white shadow-[0_0_10px_rgba(124,58,237,0.3)]" 
                  : "text-dark-400 hover:text-white hover:bg-white/5"
               }`}
            >
               Applications
            </button>
            <button
               onClick={() => setTab("guardians")}
               className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  tab === "guardians" 
                  ? "bg-primary-600 text-white shadow-[0_0_10px_rgba(124,58,237,0.3)]" 
                  : "text-dark-400 hover:text-white hover:bg-white/5"
               }`}
            >
               Active Force
            </button>
         </div>
      }
    >
      {tab === "applications" && (
         <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
               {["pending", "approved", "rejected"].map((k) => (
                  <button
                     key={k}
                     onClick={() => setAppFilter(k as any)}
                     className={`px-4 py-1.5 rounded-lg text-xs font-bold border uppercase tracking-wider transition-all ${
                        appFilter === k 
                        ? "bg-white/10 border-white/20 text-white shadow-sm" 
                        : "border-transparent text-dark-500 hover:bg-white/5"
                     }`}
                  >
                     {k}
                  </button>
               ))}
            </div>
            
            <div className="space-y-2">
               {loading && items.length === 0 ? (
                  Array.from({length:5}).map((_,i) => <GuardianAppRowSkeleton key={i}/>)
               ) : items.length === 0 ? (
                   <div className="text-center py-12 text-dark-500">No applications found.</div>
               ) : (
                   items.map(a => (
                      <div 
                         key={a.id} 
                         onClick={() => { setSelected(a); setModalOpen(true); }}
                         className="hud-panel p-4 cursor-pointer hover:border-primary-500/30 transition-all flex items-center gap-4 group"
                      >
                         {/* Avatar: Added shrink-0 to prevent squeezing */}
                         <div className="w-12 h-12 rounded-full bg-dark-800 border border-white/10 overflow-hidden relative shrink-0">
                            {a.user?.avatar_url && <img src={a.user.avatar_url} className="w-full h-full object-cover" />}
                         </div>
                         
                         {/* Content: Added min-w-0 to allow truncation */}
                         <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-dark-100 group-hover:text-primary-300 transition-colors truncate">
                               {a.user?.full_name}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-dark-400 mt-1">
                                <span className="shrink-0">{a.hours_per_week} hrs/week</span>
                                <span>•</span>
                                <span className="truncate">{a.user?.email}</span>
                            </div>
                         </div>

                         {/* Badge: Added shrink-0 to prevent poking out */}
                         <span className={`text-[10px] uppercase font-bold px-3 py-1 rounded-full border shrink-0 ${statusPill(a.status || 'pending')}`}>
                            {a.status}
                         </span>
                      </div>
                   ))
               )}
            </div>
         </div>
      )}

      {tab === "guardians" && (
         <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                <input
                   value={guardianSearch}
                   onChange={(e) => setGuardianSearch(e.target.value)}
                   placeholder="Search active guardians..."
                   className="w-full h-11 pl-10 pr-4 bg-[#1E1B24] border border-white/10 rounded-xl text-sm focus:outline-none focus:border-primary-500/50 focus:shadow-[0_0_15px_rgba(124,58,237,0.15)] transition-all"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
               {filteredGuardians.map((g) => (
                <div key={g.id} className="glass-card flex items-center justify-between gap-4 group">
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
                    className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
         </div>
      )}

      {/* Keep Modals and Lightbox exactly as is */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Application Details" size="xl">
          {selected && (
             <div className="space-y-6">
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                   <div className="w-16 h-16 rounded-full overflow-hidden border border-white/10">
                        {selected.user?.avatar_url && <img src={selected.user.avatar_url} className="w-full h-full object-cover" />}
                   </div>
                   <div>
                       <p className="text-xl font-bold text-dark-100">{selected.user?.full_name}</p>
                       <p className="text-dark-400 text-sm">{selected.user?.email}</p>
                   </div>
                </div>
                
                <div className="p-4 bg-[#121016] rounded-xl border border-white/5">
                   <p className="text-xs text-dark-500 uppercase tracking-widest mb-2 font-bold">Motivation</p>
                   <p className="text-dark-200 whitespace-pre-wrap leading-relaxed">"{selected.motivation}"</p>
                </div>

                <div className="p-4 bg-[#121016] rounded-xl border border-white/5">
                   <p className="text-xs text-dark-500 uppercase tracking-widest mb-2 font-bold">Experience</p>
                   <p className="text-dark-200 whitespace-pre-wrap leading-relaxed">{selected.experience || "None provided"}</p>
                </div>

                {selected.status === 'pending' && (
                    <div className="flex gap-3 pt-4 border-t border-white/10">
                    <Button className="flex-1 bg-green-600 hover:bg-green-500 border-none shadow-lg shadow-green-900/20 py-6" onClick={() => handleDecision("approve")}>
                        <CheckCircle className="w-5 h-5 mr-2"/> Approve Application
                    </Button>
                    <Button className="flex-1 py-6" variant="danger" onClick={() => handleDecision("reject")}>
                        <XCircle className="w-5 h-5 mr-2"/> Reject
                    </Button>
                    </div>
                )}
             </div>
          )}
      </Modal>
      
      <ImageLightbox isOpen={lightboxOpen} onClose={() => setLightboxOpen(false)} imageUrl={lightboxUrl} caption={selected?.user?.full_name || null} />
      
      <Modal isOpen={revokeModalOpen} onClose={() => setRevokeModalOpen(false)} title="Revoke Access" size="md">
         <div className="space-y-4">
             <p className="text-dark-200">Are you sure you want to remove <strong className="text-white">{revokeTarget?.full_name}</strong> from the Guardian force?</p>
             <div className="flex gap-3 mt-4">
                 <Button className="flex-1" variant="secondary" onClick={() => setRevokeModalOpen(false)}>Cancel</Button>
                 <Button className="flex-1" variant="danger" onClick={confirmRevokeGuardian} isLoading={actionLoading}>Confirm Removal</Button>
             </div>
         </div>
      </Modal>
      
      {toast && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full bg-dark-900 border border-white/10 shadow-2xl text-white font-medium animate-in fade-in slide-in-from-top-4">
            {toast}
        </div>
      )}
    </HudShell>
  );
}