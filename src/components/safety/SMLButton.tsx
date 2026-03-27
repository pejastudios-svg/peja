"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/api";
import { Portal } from "@/components/ui/Portal";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import {
  MapPin,
  X,
  Radio,
  CheckCircle,
  Clock,
  Loader2,
  Users,
  ChevronRight,
  Eye,
  Shield,
  AlertTriangle,
  User,
} from "lucide-react";

interface SharedWithMe {
  id: string;
  user_id: string;
  status: "active" | "missed";
  next_check_in_at: string;
  full_name: string;
  avatar_url: string | null;
}

interface ActiveCheckIn {
  id: string;
  status: "active" | "missed";
  contact_ids: string[];
  check_in_interval_minutes: number;
  next_check_in_at: string;
  last_confirmed_at: string;
  missed_count: number;
}

interface AcceptedContact {
  contact_user_id: string;
  full_name: string;
  avatar_url: string | null;
}

const INTERVAL_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
];

export function SMLButton() {
  const router = useRouter();
  const { user, session } = useAuth();
  const toast = useToast();
  const cancellingRef = useRef(false);

  const [showMenu, setShowMenu] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showActiveModal, setShowActiveModal] = useState(false);
  const [showSharedList, setShowSharedList] = useState(false);

  // My check-in state
  const [myCheckIn, setMyCheckIn] = useState<ActiveCheckIn | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("peja-sml-active");
        return saved ? JSON.parse(saved) : null;
      } catch { return null; }
    }
    return null;
  });
  const [timeLeft, setTimeLeft] = useState("");
  const [isOverdue, setIsOverdue] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // People sharing with me
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMe[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("peja-sml-shared");
        return saved ? JSON.parse(saved) : [];
      } catch { return []; }
    }
    return [];
  });

  // Share flow
  const [contacts, setContacts] = useState<AcceptedContact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [interval, setInterval_] = useState(60);
  const [starting, setStarting] = useState(false);
  const [startPhase, setStartPhase] = useState<string | null>(null);

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useScrollFreeze(showMenu || showShareModal || showActiveModal || showCancelConfirm);

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  }), [session?.access_token]);

  // Fetch my check-in status + people sharing with me
  const fetchData = useCallback(async () => {
    if (!session?.access_token || !user) return;

    try {
      // My check-in
      const statusRes = await fetch(apiUrl("/api/checkin/status/"), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const statusData = await statusRes.json();

      if (cancellingRef.current) { /* skip update during confirm/cancel */ }
      else if (statusData.active && statusData.checkin) {
        setMyCheckIn(statusData.checkin);
        setIsOverdue(statusData.isOverdue);
      } else {
        setMyCheckIn(null);
        setIsOverdue(false);
      }

      // People sharing with me
      const { data: checkins } = await supabase
        .from("safety_checkins")
        .select("id, user_id, status, next_check_in_at")
        .contains("contact_ids", [user.id])
        .in("status", ["active", "missed"]);

      if (checkins && checkins.length > 0) {
        const userIds = checkins.map((c: any) => c.user_id);
        const { data: users } = await supabase
          .from("users")
          .select("id, full_name, avatar_url")
          .in("id", userIds);

        const userMap: Record<string, any> = {};
        (users || []).forEach((u: any) => { userMap[u.id] = u; });

        setSharedWithMe(checkins.map((c: any) => ({
          id: c.id,
          user_id: c.user_id,
          status: c.status,
          next_check_in_at: c.next_check_in_at,
          full_name: userMap[c.user_id]?.full_name || "Unknown",
          avatar_url: userMap[c.user_id]?.avatar_url || null,
        })));
      } else {
        setSharedWithMe([]);
      }
    } catch {}
  }, [session?.access_token, user]);

  // Fetch contacts for share flow
  const fetchContacts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("emergency_contacts")
      .select("contact_user_id")
      .eq("user_id", user.id)
      .eq("status", "accepted");

    if (data && data.length > 0) {
      const ids = data.map((c: any) => c.contact_user_id);
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .in("id", ids);

      setContacts((users || []).map((u: any) => ({
        contact_user_id: u.id,
        full_name: u.full_name || "Unknown",
        avatar_url: u.avatar_url,
      })));
    }
  }, [user]);

  const closeMenu = useCallback(() => {
    setMenuClosing(true);
    setTimeout(() => {
      setShowMenu(false);
      setMenuClosing(false);
    }, 200);
  }, []);

  useEffect(() => {
    fetchData();
    pollingRef.current = setInterval(fetchData, 30000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchData]);

  // Countdown
  useEffect(() => {
    if (!myCheckIn) { setTimeLeft(""); return; }
    const update = () => {
      const diff = new Date(myCheckIn.next_check_in_at).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft("Overdue"); setIsOverdue(true); return; }
      setIsOverdue(false);
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [myCheckIn]);

  // Realtime for my check-in
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("sml-self-rt")
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "safety_checkins", filter: `user_id=eq.${user.id}` },
         (payload) => {
          if (cancellingRef.current) return;
          const u = payload.new as any;
          if (u.status === "cancelled") { setMyCheckIn(null); setIsOverdue(false); }
          else if (u.status === "active" || u.status === "missed") {
            setMyCheckIn(u);
            setIsOverdue(u.status === "missed");
          }
        }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // Persist active check-in state for instant render
  useEffect(() => {
    if (myCheckIn) {
      localStorage.setItem("peja-sml-active", JSON.stringify(myCheckIn));
    } else {
      localStorage.removeItem("peja-sml-active");
    }
  }, [myCheckIn]);

  useEffect(() => {
    if (sharedWithMe.length > 0) {
      localStorage.setItem("peja-sml-shared", JSON.stringify(sharedWithMe));
    } else {
      localStorage.removeItem("peja-sml-shared");
    }
  }, [sharedWithMe]);

const handleButtonClick = () => {
    if (myCheckIn && sharedWithMe.length === 0) {
      // Only my check-in active, no one sharing with me
      setShowActiveModal(true);
      return;
    }
    if (!myCheckIn && sharedWithMe.length === 0) {
      // Nothing active, go straight to share
      fetchContacts();
      setShowShareModal(true);
      return;
    }
    // Either people sharing with me, or both active - show menu
    setShowMenu(true);
  };

  const handleStart = async () => {
    if (selectedContacts.length === 0) { toast.warning("Select at least one contact"); return; }
    setStarting(true);
    setStartPhase("Pinpointing your location...");
    try {
      let lat, lng;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        lat = pos.coords.latitude; lng = pos.coords.longitude;
      } catch {}

      setStartPhase("Starting location sharing...");
      const res = await fetch(apiUrl("/api/checkin/start/"), {
        method: "POST", headers: headers(),
        body: JSON.stringify({ contactIds: selectedContacts, intervalMinutes: interval }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      setStartPhase("Informing your contacts...");
      await new Promise(r => setTimeout(r, 400));

      setMyCheckIn(data.checkin);
      setShowShareModal(false);
      setShowMenu(false);
      toast.success("Location sharing started!");
    } catch (err: any) {
      toast.danger(err.message || "Failed to start");
    } finally {
      setStarting(false);
      setStartPhase(null);
    }
  };

const handleConfirm = async () => {
    if (!myCheckIn) return;
    cancellingRef.current = true;
    const newNext = new Date(Date.now() + myCheckIn.check_in_interval_minutes * 60000).toISOString();
    setMyCheckIn(prev => prev ? { ...prev, status: "active", next_check_in_at: newNext, missed_count: 0 } : null);
    setIsOverdue(false);
    toast.success("Checked in! Timer reset.");

    try {
      let lat, lng;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        lat = pos.coords.latitude; lng = pos.coords.longitude;
      } catch {}
await fetch(apiUrl("/api/checkin/confirm/"), {
        method: "POST", headers: headers(),
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
    } catch {}
    setTimeout(() => { cancellingRef.current = false; }, 3000);
  };

  const handleCancel = async () => {
    cancellingRef.current = true;
    setMyCheckIn(null);
    setShowCancelConfirm(false);
    setShowActiveModal(false);
    toast.success("Check-in ended.");
    try {
      await fetch(apiUrl("/api/checkin/cancel/"), { method: "POST", headers: headers() });
   } catch {
      cancellingRef.current = false;
      fetchData();
      return;
    }
    setTimeout(() => { cancellingRef.current = false; }, 3000);
  };

  const hasSharedWithMe = sharedWithMe.length > 0;
  const isActive = !!myCheckIn;
  const showPulse = isActive || hasSharedWithMe;

  if (!user) return null;

  return (
    <>
      {/* Floating button */}
     <button
        data-tutorial="nav-sml"
        onClick={handleButtonClick}
        className="relative flex items-center justify-center transition-all active:scale-90"
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: isOverdue
            ? "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)"
            : isActive
            ? "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
            : "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
          boxShadow: isOverdue
            ? "0 4px 15px rgba(220, 38, 38, 0.4)"
            : isActive
            ? "0 4px 15px rgba(34, 197, 94, 0.4)"
            : "0 4px 15px rgba(124, 58, 237, 0.4)",
        }}
      >
        {/* Pulse ring */}
        {showPulse && (
          <div
            className="absolute inset-0 rounded-full animate-ping"
            style={{
              background: isOverdue
                ? "rgba(220, 38, 38, 0.3)"
                : isActive
                ? "rgba(34, 197, 94, 0.3)"
                : "rgba(124, 58, 237, 0.3)",
              animationDuration: "2s",
            }}
          />
        )}

        <MapPin className="w-5 h-5 text-white relative z-10" />

       {/* Badge for shared-with-me count */}
        {hasSharedWithMe && (
          <div
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white z-20"
            style={{ background: "#22c55e", border: "2px solid #0c0818" }}
          >
            {sharedWithMe.length}
          </div>
        )}
      </button>

      {/* ===== MENU POPUP (when people share with you) ===== */}
      {showMenu && (
        <Portal>
          <div className="fixed inset-0 z-[9998]" onClick={closeMenu} />
<div
            className="fixed z-[9999] flex justify-center px-4"
            style={{
              bottom: "calc(200px + env(safe-area-inset-bottom, 0px))",
              left: 0,
              right: 0,
            }}
          >
          <div
            className={`rounded-2xl overflow-hidden ${menuClosing ? "animate-bounce-out" : "animate-bounce-in"}`}
            style={{
              width: 340,
              maxWidth: "100%",
              background: "rgba(18, 12, 36, 0.98)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 -10px 40px rgba(0,0,0,0.6), 0 0 20px rgba(124,58,237,0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Shared with me section */}
            <div className="p-3 border-b border-white/5">
              <p className="text-[10px] text-dark-500 uppercase tracking-wider font-bold mb-2">Sharing with you</p>
              <div className="space-y-1.5">
                {sharedWithMe.map((s) => {
                  const diff = new Date(s.next_check_in_at).getTime() - Date.now();
                  const overdue = diff <= 0;
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setShowMenu(false);
                        router.push(`/checkin/track/${s.id}`);
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/5 transition-colors"
                    >
                      <div className="relative shrink-0">
                        <div
                          className="w-9 h-9 rounded-full overflow-hidden"
                          style={{
                            border: `2.5px solid ${overdue ? "#ef4444" : "#22c55e"}`,
                            boxShadow: `0 0 8px ${overdue ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
                          }}
                        >
                          {s.avatar_url ? (
                            <img src={s.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-dark-700 flex items-center justify-center">
                              <User className="w-4 h-4 text-dark-400" />
                            </div>
                          )}
                        </div>
                        {overdue && (
                          <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 flex items-center justify-center border border-dark-900">
                            <AlertTriangle className="w-2 h-2 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className="text-xs font-medium text-white truncate">{s.full_name}</p>
                        <p className={`text-[10px] ${overdue ? "text-red-400" : "text-green-400"}`}>
                          {overdue ? "Check-in overdue" : "Sharing location"}
                        </p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-dark-500" />
                    </button>
                  );
                })}
              </div>
           {sharedWithMe.length >= 1 && (
                <button
                  onClick={() => { closeMenu(); router.push("/checkin/shared"); }}
                  className="w-full mt-2 py-2 rounded-xl text-xs font-medium text-primary-400 bg-primary-500/10 border border-primary-500/20 hover:bg-primary-500/15 transition-colors"
                >
                  View All Locations
                </button>
              )}
            </div>

{/* My check-in status or share option */}
            {myCheckIn ? (
              <button
                onClick={() => { closeMenu(); setShowActiveModal(true); }}
                className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors border-t border-white/5"
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${isOverdue ? "bg-red-500/15" : "bg-green-500/15"}`}>
                  {isOverdue ? <AlertTriangle className="w-4 h-4 text-red-400" /> : <Radio className="w-4 h-4 text-green-400 animate-pulse" />}
                </div>
                <div className="text-left flex-1">
                  <p className={`text-xs font-medium ${isOverdue ? "text-red-400" : "text-green-400"}`}>
                    {isOverdue ? "Check-In Overdue" : "My Location Active"}
                  </p>
                  <p className="text-[10px] text-dark-500">{timeLeft}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-dark-500" />
              </button>
            ) : (
              <button
                onClick={() => { closeMenu(); fetchContacts(); setShowShareModal(true); }}
                className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors border-t border-white/5"
              >
                <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-primary-400" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-medium text-white">Share My Location</p>
                  <p className="text-[10px] text-dark-500">Alert emergency contacts</p>
                </div>
              </button>
            )}
           </div>
          </div>
        </Portal>
      )}

      {/* ===== ACTIVE CHECK-IN MODAL ===== */}
      {showActiveModal && myCheckIn && (
        <Portal>
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9998]" onClick={() => setShowActiveModal(false)} />
          <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center pointer-events-none">
            <div
              className="w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-5 pointer-events-auto animate-bounce-in"
              style={{
                background: "rgba(18, 12, 36, 0.98)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 -10px 40px rgba(0,0,0,0.5)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isOverdue ? "bg-red-500/15" : "bg-green-500/15"}`}>
                  {isOverdue ? <AlertTriangle className="w-6 h-6 text-red-400" /> : <Radio className="w-6 h-6 text-green-400 animate-pulse" />}
                </div>
                <div>
                  <p className={`text-sm font-bold ${isOverdue ? "text-red-400" : "text-green-400"}`}>
                    {isOverdue ? "Check-In Overdue!" : "Sharing Location"}
                  </p>
                  <p className="text-xs text-dark-400">
                    {isOverdue ? "Your contacts have been notified" : `Next check-in: ${timeLeft}`}
                  </p>
                </div>
                <div className="ml-auto">
                  <p className={`text-xl font-bold ${isOverdue ? "text-red-400" : "text-green-400"}`}>{timeLeft}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  className={`flex-1 py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 text-white active:scale-[0.95] transition-transform ${isOverdue ? "bg-red-600" : "bg-green-600"}`}
                >
                  <CheckCircle className="w-4 h-4" />
                  I'm OK
                </button>
                 <button
                  onClick={() => { setShowActiveModal(false); setShowCancelConfirm(true); }}
                  className="px-5 py-3.5 rounded-xl text-sm font-medium bg-white/5 text-dark-300 border border-white/10 active:scale-[0.95] transition-transform"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ===== CANCEL CONFIRM ===== */}
      {showCancelConfirm && (
        <Portal>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000]" onClick={() => { setShowCancelConfirm(false); setShowActiveModal(true); }} />
          <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
            <div
              className="w-full max-w-sm rounded-2xl p-6 animate-bounce-in"
              style={{ background: "rgba(18, 12, 36, 0.98)", border: "1px solid rgba(255,255,255,0.1)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-white mb-2">Stop Sharing?</h3>
              <p className="text-sm text-dark-400 mb-4">Your contacts will be notified that you stopped sharing.</p>
              <div className="flex gap-3">
                <button onClick={() => { setShowCancelConfirm(false); setShowActiveModal(true); }} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 text-dark-200 border border-white/10">Keep Sharing</button>
                <button onClick={handleCancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white">Stop</button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ===== SHARE MODAL ===== */}
      {showShareModal && (
        <Portal>
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9998]" onClick={() => setShowShareModal(false)} />
          <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center pointer-events-none">
            <div
              className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl pointer-events-auto animate-bounce-in"
              style={{
                background: "rgba(18, 12, 36, 0.98)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 -10px 40px rgba(0,0,0,0.5)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-1 sm:hidden">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-lg font-bold text-white">Share My Location</h2>
                    <p className="text-sm text-dark-400">Alert your emergency contacts</p>
                  </div>
                  <button onClick={() => setShowShareModal(false)} className="p-1.5 rounded-lg hover:bg-white/10">
                    <X className="w-5 h-5 text-dark-400" />
                  </button>
                </div>

                {/* Contacts */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-dark-200">
                      <Users className="w-4 h-4 inline mr-1.5" />Share with
                    </label>
                    <button
                      onClick={() => {
                        if (selectedContacts.length === contacts.length) setSelectedContacts([]);
                        else setSelectedContacts(contacts.map(c => c.contact_user_id));
                      }}
                      className="text-xs text-primary-400"
                    >
                      {selectedContacts.length === contacts.length ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {contacts.length === 0 ? (
                      <p className="text-sm text-dark-500 text-center py-4">No accepted contacts. Add emergency contacts first.</p>
                    ) : contacts.map(c => {
                      const sel = selectedContacts.includes(c.contact_user_id);
                      return (
                        <button
                          key={c.contact_user_id}
                          onClick={() => setSelectedContacts(prev => sel ? prev.filter(id => id !== c.contact_user_id) : [...prev, c.contact_user_id])}
                          className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-colors ${sel ? "bg-primary-600/15 border border-primary-500/30" : "bg-white/5 border border-white/5"}`}
                        >
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${sel ? "bg-primary-600" : "border border-dark-500"}`}>
                            {sel && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                          </div>
                          <div className="w-7 h-7 rounded-full bg-primary-600/20 overflow-hidden shrink-0">
                            {c.avatar_url ? <img src={c.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-primary-400">{c.full_name[0]}</div>}
                          </div>
                          <span className="text-sm text-dark-100">{c.full_name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Timer */}
                <div className="mb-5">
                  <label className="text-sm font-medium text-dark-200 mb-2 block">
                    <Clock className="w-4 h-4 inline mr-1.5" />Check-in every
                  </label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {INTERVAL_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setInterval_(opt.value)}
                        className={`py-2 rounded-xl text-xs font-medium transition-colors ${interval === opt.value ? "bg-primary-600 text-white" : "bg-white/5 text-dark-300"}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Loading phase */}
                {starting && startPhase && (
                  <div className="mb-4 p-3 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
                    <p className="text-sm text-primary-400 font-medium">{startPhase}</p>
                  </div>
                )}

                {/* Start button */}
                <button
                  onClick={handleStart}
                  disabled={starting || selectedContacts.length === 0}
                  className="w-full py-3.5 rounded-xl font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  style={{
                    background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                    boxShadow: "0 4px 20px rgba(124, 58, 237, 0.3)",
                  }}
                >
                  {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                  Start Sharing
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}