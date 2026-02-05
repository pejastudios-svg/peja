"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import { useRouter } from "next/navigation";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";
import {
  AlertTriangle,
  MapPin,
  Clock,
  User,
  Loader2,
  CheckCircle,
  XCircle,
  Eye,
  Phone,
  Trash2,
  MessageCircle, 
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface SOSData {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  address: string;
  status: string;
  tag: string;
  message: string;
  voice_note_url: string;
  created_at: string;
  resolved_at: string;
  users?: { full_name: string; email: string; phone: string; avatar_url: string };
}

export default function AdminSOSPage() {
  useScrollRestore("admin:sos");
    const router = useRouter();
  const [sosAlerts, setSOSAlerts] = useState<SOSData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedSOS, setSelectedSOS] = useState<SOSData | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
    const [sosContacts, setSosContacts] = useState<any[]>([]);
  const [sosContactsLoading, setSosContactsLoading] = useState(false);

  const fetchSOSUserContacts = async (userId: string) => {
    setSosContactsLoading(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");

      const res = await fetch("/api/admin/user-emergency-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");
      setSosContacts(json.contacts || []);
    } catch (e) {
      console.error("fetchSOSUserContacts error:", e);
      setSosContacts([]);
    } finally {
      setSosContactsLoading(false);
    }
  };
  const { session } = useAuth();

  useEffect(() => {
    fetchSOS();

    // Real-time updates
    const channel = supabase
      .channel('admin-sos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => {
        fetchSOS();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [statusFilter]);

  function AdminSOSRowSkeleton() {
  return (
    <div className="glass-card">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-full shrink-0" />
        <div className="flex-1">
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

  const fetchSOS = async () => {
  setLoading(true);
  try {
    // Auto-resolve active SOS older than 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { error: expireErr } = await supabase
      .from("sos_alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("status", "active")
      .lt("created_at", cutoff);

    if (expireErr) console.error("Auto-expire SOS failed:", expireErr);

    // Fetch SOS (no embedded joins)
    let query = supabase
      .from("sos_alerts")
      .select("id,user_id,latitude,longitude,address,status,tag,message,voice_note_url,created_at,resolved_at")
      .order("created_at", { ascending: false });

    if (statusFilter !== "all") query = query.eq("status", statusFilter);


    
    const { data: sosData, error } = await query.limit(100);
    if (error) throw error;

    const rows = (sosData || []) as any[];
    const userIds = Array.from(new Set(rows.map(r => r.user_id).filter(Boolean)));

    const { data: usersData, error: usersErr } = userIds.length
      ? await supabase.from("users").select("id,full_name,email,phone,avatar_url").in("id", userIds)
      : { data: [], error: null };

    if (usersErr) console.error("SOS users fetch error:", usersErr);

    const usersMap: Record<string, any> = {};
    (usersData || []).forEach((u: any) => (usersMap[u.id] = u));

    setSOSAlerts(rows.map((s) => ({ ...s, users: usersMap[s.user_id] })));
  } catch (e) {
    console.error("Error fetching SOS:", e);
    setSOSAlerts([]);
  } finally {
    setLoading(false);
  }
};

const handleDeleteSOS = async (sosId: string) => {
  if (!session?.access_token) {
    alert("No session token. Please sign in again.");
    return;
  }
  if (!confirm("Delete this SOS permanently?")) return;

  setActionLoading(true);
  try {
    const res = await fetch("/api/admin/sos/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ sosId }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

    await fetchSOS();
    setShowModal(false);
    setSelectedSOS(null);
  } catch (e: any) {
    console.error(e);
    alert(e.message || "Failed");
  } finally {
    setActionLoading(false);
  }
};


const handleDeleteSOSRecord = async (e: React.MouseEvent, sosId: string) => { 
  e.preventDefault();
  e.stopPropagation();


  setActionLoading(true);
  try {
    const { data: auth } = await supabase.auth.getSession();
    const token = auth.session?.access_token;
    if (!token) throw new Error("Session expired. Please sign in again.");

    const res = await fetch("/api/admin/sos/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sosId }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "Failed to delete SOS");

    // remove from UI
    setSOSAlerts((prev) => prev.filter((x) => x.id !== sosId));
    if (selectedSOS?.id === sosId) {
      setShowModal(false);
      setSelectedSOS(null);
    }
  } catch (err) {
    console.error(err);
    alert("Failed to delete SOS");
  } finally {
    setActionLoading(false);
  }
};

  const handleStatusChange = async (sosId: string, newStatus: string) => {
  if (!session?.access_token) {
    alert("No session token. Please sign in again.");
    return;
  }

  setActionLoading(true);
  try {
    const res = await fetch("/api/admin/sos/set-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ sosId, status: newStatus }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

    await fetchSOS();
    setShowModal(false);
    setSelectedSOS(null);
  } catch (e: any) {
    console.error(e);
    alert(e.message || "Failed");
  } finally {
    setActionLoading(false);
  }
};

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-red-500/20 text-red-400 border-red-500/30";
      case "resolved": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "cancelled": return "bg-gray-500/20 text-gray-400 border-gray-500/30";
      case "false_alarm": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      default: return "bg-dark-600 text-dark-400";
    }
  };

  const activeCount = sosAlerts.filter(s => s.status === "active").length;

  return (
    <HudShell
      title="SOS Monitor"
      subtitle="Critical emergency alerts and response coordination"
      right={
         <div className="flex gap-1 bg-[#1E1B24] p-1 rounded-xl border border-white/10">
            {["all", "active", "resolved"].map((status) => (
               <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${
                     statusFilter === status 
                     ? "bg-primary-600 text-white shadow-lg shadow-primary-500/20" 
                     : "text-dark-400 hover:text-white hover:bg-white/5"
                  }`}
               >
                  {status}
               </button>
            ))}
         </div>
      }
    >
      {/* Active Alert Banner */}
      {activeCount > 0 && (
        <div className="mb-6 p-1 rounded-2xl bg-linear-to-r from-red-500/40 via-red-500/20 to-transparent">
            <div className="p-4 rounded-xl bg-[#1a0505] border border-red-500/30 flex items-center gap-4 relative overflow-hidden">
                <div className="absolute inset-0 bg-red-500/5 animate-pulse" />
                <div className="relative z-10 p-3 bg-red-500/20 rounded-full border border-red-500/30">
                    <AlertTriangle className="w-6 h-6 text-red-400 animate-pulse" />
                </div>
                <div className="relative z-10">
                    <p className="text-xl font-bold text-red-100">{activeCount} Active Emergenc{activeCount > 1 ? 'ies' : 'y'}</p>
                    <p className="text-sm text-red-300/80">Immediate response required. Dispatch protocols active.</p>
                </div>
           </div>
        </div>
      )}

      {/* SOS List */}
      <div className="grid grid-cols-1 gap-3">
         {loading && sosAlerts.length === 0 ? (
            Array.from({ length: 6 }).map((_, i) => <AdminSOSRowSkeleton key={i} />)
         ) : sosAlerts.length === 0 ? (
            <HudPanel className="text-center py-20 flex flex-col items-center">
               <div className="w-20 h-20 rounded-full bg-green-500/5 border border-green-500/10 flex items-center justify-center mb-4">
                 <CheckCircle className="w-10 h-10 text-green-500/50" />
               </div>
               <p className="text-dark-300 font-medium">System Secure</p>
               <p className="text-dark-500 text-sm mt-1">No SOS alerts matching your criteria.</p>
            </HudPanel>
         ) : (
            sosAlerts.map((sos) => (
               <div
                  key={sos.id}
                  onClick={() => { setSelectedSOS(sos); setShowModal(true); fetchSOSUserContacts(sos.user_id); }}
                  className={`hud-panel p-4 cursor-pointer hover:border-primary-500/30 transition-all group relative overflow-hidden ${
                     sos.status === "active" ? "border-red-500/40 bg-red-500/5" : ""
                  }`}
               >
                  {sos.status === 'active' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 shadow-[0_0_10px_#ef4444]" />}
                  
                  <div className="flex items-start gap-4 pl-2">
                     <div className={`w-12 h-12 rounded-full border-2 overflow-hidden shrink-0 ${sos.status === 'active' ? 'border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]' : 'border-white/10'}`}>
                        {sos.users?.avatar_url ? (
                           <img src={sos.users.avatar_url} className="w-full h-full object-cover" />
                        ) : (
                           <div className="w-full h-full bg-dark-800 flex items-center justify-center">
                               <User className="w-5 h-5 text-dark-500" />
                           </div>
                        )}
                     </div>
                     
                     <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                           <p className="text-dark-100 font-bold text-lg">{sos.users?.full_name || "Unknown User"}</p>
                           <span className={`text-[10px] uppercase font-bold px-3 py-1 rounded-full border ${getStatusColor(sos.status)}`}>
                              {sos.status.replace("_", " ")}
                           </span>
                        </div>
                        
                        <div className="flex items-center gap-2 mb-2 text-dark-300">
                           <MapPin className="w-4 h-4 text-dark-500 shrink-0" />
                           <p className="text-sm truncate font-medium">{sos.address || "Location unavailable"}</p>
                        </div>
                        
                        <div className="flex items-center gap-4 text-xs text-dark-500 border-t border-white/5 pt-2 mt-2">
                           <span className="flex items-center gap-1.5"><Clock className="w-3 h-3"/> {formatDistanceToNow(new Date(sos.created_at), { addSuffix: true })}</span>
                           {sos.tag && <span className="px-2 py-0.5 bg-white/5 rounded border border-white/10 text-dark-400">{sos.tag}</span>}
                        </div>
                     </div>

                     <div className="self-center pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-10 h-10 rounded-xl bg-primary-600/20 text-primary-300 flex items-center justify-center border border-primary-500/20">
                           <Eye className="w-5 h-5" />
                        </div>
                     </div>
                  </div>
               </div>
            ))
         )}
      </div>

      {/* Modal - Preserving ALL content functionality */}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setSelectedSOS(null); setSosContacts([]); }}
        title="Emergency Detail"
        size="lg"
      >
        {selectedSOS && (
          <div className="space-y-6">
            {/* Header / User */}
            <div className="flex items-center gap-4 p-5 bg-linear-to-br from-[#2a2735] to-[#1E1B24] rounded-2xl border border-white/10">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-red-500/50 shadow-lg shrink-0">
                {selectedSOS.users?.avatar_url ? (
                  <img src={selectedSOS.users.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-dark-700 flex items-center justify-center">
                    <User className="w-8 h-8 text-dark-400" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <p className="font-bold text-dark-100 text-xl">{selectedSOS.users?.full_name || "Unknown"}</p>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-1">
                {selectedSOS.users?.phone && (
                <a href={`tel:${selectedSOS.users.phone}`} className="px-3 py-1 rounded-lg bg-green-500/10 text-green-400 text-sm font-medium border border-green-500/20 flex items-center gap-2 hover:bg-green-500/20 w-fit">
                <Phone className="w-3.5 h-3.5" /> {selectedSOS.users.phone}
                </a>
                )}
               <span className="text-dark-400 text-sm truncate">{selectedSOS.users?.email}</span>
               </div>
              </div>
            </div>

            {/* Contacts Section */}
            <div className="rounded-xl border border-white/10 overflow-hidden">
                <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex justify-between items-center">
                    <h3 className="text-xs font-bold text-dark-300 uppercase tracking-wider">Emergency Contacts</h3>
                    <Button variant="secondary" size="sm" onClick={() => fetchSOSUserContacts(selectedSOS.user_id)} disabled={sosContactsLoading} className="h-7 text-xs">
                        Refresh
                    </Button>
                </div>
                <div className="p-3 bg-[#131118]">
                    {sosContactsLoading ? (
                        <p className="text-sm text-dark-400 p-2">Syncing contacts...</p>
                    ) : sosContacts.length === 0 ? (
                        <p className="text-sm text-dark-500 p-2 italic">No emergency contacts listed.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {sosContacts.map((c: any) => (
                            <div key={c.id} className="p-3 rounded-lg bg-white/5 border border-white/5 flex flex-col gap-2">
                                <div>
                                    <p className="text-sm text-dark-100 font-bold">{c.contact_user?.full_name || "Unknown"}</p>
                                    <p className="text-xs text-dark-400">{c.relationship || "Contact"}</p>
                                </div>
                                <div className="flex gap-2 mt-auto">
                                    {c.contact_user?.phone && (
                                    <a className="flex-1 text-center text-xs py-1.5 rounded bg-green-900/30 text-green-400 border border-green-500/20 hover:bg-green-900/50 transition-colors" href={`tel:${c.contact_user.phone}`}>Call</a>
                                    )}
                                    {c.contact_user?.id && (
                                    <button className="flex-1 text-center text-xs py-1.5 rounded bg-white/5 text-dark-300 hover:bg-white/10 border border-white/5" onClick={() => router.push(`/admin/users/${c.contact_user.id}`)}>
                                        Profile
                                    </button>
                                    )}
                                </div>
                            </div>
                        ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Message & Audio */}
            <div className="grid grid-cols-1 gap-4">
                {selectedSOS.message && (
                <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-xl">
                    <p className="text-xs text-red-300 uppercase font-bold mb-2 flex items-center gap-2">
                        <MessageCircle className="w-3 h-3" /> User Message
                    </p>
                    <p className="text-dark-100 text-lg leading-relaxed font-medium">"{selectedSOS.message}"</p>
                </div>
                )}

                {selectedSOS.voice_note_url && (
                <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                    <p className="text-xs text-dark-400 uppercase font-bold mb-2">Audio Evidence</p>
                    <audio src={selectedSOS.voice_note_url} controls className="w-full h-8" />
                </div>
                )}
            </div>
            
            {/* Meta Data */}
             <div className="grid grid-cols-2 gap-4 text-sm p-4 rounded-xl bg-black/20 border border-white/5">
                <div>
                   <p className="text-dark-500 text-xs">Lat/Long</p>
                   <p className="text-dark-300 font-mono">{selectedSOS.latitude?.toFixed(6)}, {selectedSOS.longitude?.toFixed(6)}</p>
                </div>
                <div>
                    <p className="text-dark-500 text-xs">Created At</p>
                    <p className="text-dark-300">{format(new Date(selectedSOS.created_at), "PPpp")}</p>
                </div>
                <div className="col-span-2 pt-2 border-t border-white/5">
                    <a href={`http://maps.google.com/?q=${selectedSOS.latitude},${selectedSOS.longitude}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary-400 hover:text-primary-300 transition-colors">
                        <MapPin className="w-4 h-4" /> Open precise location in Google Maps
                    </a>
                </div>
            </div>

            {/* Actions Bar */}
            {selectedSOS.status === "active" && (
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-wrap gap-3 items-center justify-between">
                <p className="text-sm font-bold text-dark-300">Resolution:</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={() => handleStatusChange(selectedSOS.id, "resolved")} disabled={actionLoading} className="bg-green-600 hover:bg-green-500 border-none shadow-lg shadow-green-900/20">
                    <CheckCircle className="w-4 h-4 mr-2" /> Mark Resolved
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleStatusChange(selectedSOS.id, "false_alarm")} disabled={actionLoading}>
                    <AlertTriangle className="w-4 h-4 mr-2" /> False Alarm
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleStatusChange(selectedSOS.id, "cancelled")} disabled={actionLoading}>
                    Cancel
                  </Button>
                  <div className="w-px h-8 bg-white/10 mx-1" />
                  <Button variant="danger" size="sm" onClick={() => handleDeleteSOS(selectedSOS.id)} disabled={actionLoading}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </HudShell>
  );
}