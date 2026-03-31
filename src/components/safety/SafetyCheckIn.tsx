"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { apiUrl } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  MapPin,
  Clock,
  Shield,
  CheckCircle,
  X,
  Loader2,
  AlertTriangle,
  Users,
  ChevronRight,
  Radio,
} from "lucide-react";

interface CheckInContact {
  id: string;
  contact_user_id: string;
  full_name: string;
  avatar_url?: string;
  status: string;
}

interface ActiveCheckIn {
  id: string;
  status: "active" | "missed";
  contact_ids: string[];
  check_in_interval_minutes: number;
  next_check_in_at: string;
  last_confirmed_at: string;
  missed_count: number;
  latitude?: number;
  longitude?: number;
}

const INTERVAL_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
  { value: 480, label: "8 hours" },
  { value: 720, label: "12 hours" },
  { value: 1440, label: "24 hours" },
];

export function SafetyCheckIn({
  contacts,
}: {
  contacts: { id: string; contact_user_id: string; status: string; contact_user?: { id: string; full_name: string; avatar_url?: string } }[];
}) {
  const { session, user } = useAuth();
  const toast = useToast();

  const [activeCheckIn, setActiveCheckIn] = useState<ActiveCheckIn | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [interval, setInterval_] = useState(60);
  const [starting, setStarting] = useState(false);
  const [startPhase, setStartPhase] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [timeLeft, setTimeLeft] = useState("");
  const [isOverdue, setIsOverdue] = useState(false);
  const locationRef = useRef<number | null>(null);
  const cancellingRef = useRef(false);
const getWarned = () => typeof window !== "undefined" && sessionStorage.getItem("peja-checkin-warned") === "true";
  const setWarned = (v: boolean) => { if (typeof window !== "undefined") sessionStorage.setItem("peja-checkin-warned", String(v)); };
  const getExpired = () => typeof window !== "undefined" && sessionStorage.getItem("peja-checkin-expired") === "true";
  const setExpired = (v: boolean) => { if (typeof window !== "undefined") sessionStorage.setItem("peja-checkin-expired", String(v)); };

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token || ""}`,
  }), [session?.access_token]);

  const acceptedContacts: CheckInContact[] = contacts
    .filter(c => c.status === "accepted" && c.contact_user)
    .map(c => ({
      id: c.id,
      contact_user_id: c.contact_user_id,
      full_name: c.contact_user!.full_name,
      avatar_url: c.contact_user!.avatar_url,
      status: c.status,
    }));

  // Check status on mount and poll
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/checkin/status/"), { headers: headers() });
      const data = await res.json();

if (data.active && data.checkin) {
        if (cancellingRef.current) return;
        setActiveCheckIn(prev => {
          // Only update if something actually changed
          if (!prev || prev.id !== data.checkin.id || prev.status !== data.checkin.status || prev.next_check_in_at !== data.checkin.next_check_in_at) {
            return data.checkin;
          }
          return prev;
        });
        setIsOverdue(data.isOverdue);
} else if (!data.active) {
        if (!cancellingRef.current) setActiveCheckIn(null);
        setIsOverdue(false);
      }
    } catch {}
    setCheckingStatus(false);
  }, [headers]);

// Only fetch once on mount, global CheckInMonitor handles polling
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Realtime subscription for instant updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("checkin-self-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "safety_checkins", filter: `user_id=eq.${user.id}` },
(payload) => {
          if (cancellingRef.current) return;
          const updated = payload.new as any;
          if (updated.status === "cancelled") {
            setActiveCheckIn(null);
            setIsOverdue(false);
          } else if (updated.status === "active" || updated.status === "missed") {
            setActiveCheckIn(updated);
            setIsOverdue(updated.status === "missed");
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

 // Countdown timer + 5-minute warning
  useEffect(() => {
   if (!activeCheckIn) { setTimeLeft(""); setWarned(false); setExpired(false); return; }

    const update = () => {
      const now = new Date().getTime();
      const target = new Date(activeCheckIn.next_check_in_at).getTime();
      const diff = target - now;

if (diff <= 0) {
        setTimeLeft("Overdue");
        setIsOverdue(true);
// Expired toast handled by global CheckInMonitor
        return;
      }

      setIsOverdue(false);

// Warning/expired toasts handled by global CheckInMonitor

      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);

      if (hours > 0) {
        setTimeLeft(`${hours}h ${mins}m`);
      } else if (mins > 0) {
        setTimeLeft(`${mins}m ${secs}s`);
      } else {
        setTimeLeft(`${secs}s`);
      }
    };

    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [activeCheckIn, toast]);

  // Background location updates while active
  useEffect(() => {
    if (!activeCheckIn || !navigator.geolocation) return;

    const sendLocation = (lat: number, lng: number) => {
      fetch(apiUrl("/api/checkin/location/"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      }).catch(() => {});
    };

    // Get initial location
    navigator.geolocation.getCurrentPosition(
      (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
      () => {}
    );
    // Watch position for movement
    locationRef.current = navigator.geolocation.watchPosition(
      (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );
    // Also poll every 15s in case watchPosition doesn't fire (user stationary)
    const pollInterval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
      );
    }, 15000);
    return () => {
      if (locationRef.current !== null) {
        navigator.geolocation.clearWatch(locationRef.current);
        locationRef.current = null;
      }
      clearInterval(pollInterval);
    };
  }, [activeCheckIn, headers]);

 const handleStart = async () => {
    if (selectedContacts.length === 0) {
      toast.warning("Select at least one contact");
      return;
    }

    setStarting(true);
    setStartPhase("Pinpointing your location...");

    try {
      // Get location first
      let lat, lng;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {}

      setStartPhase("Gathering your contacts...");
      await new Promise(r => setTimeout(r, 400));

      setStartPhase("Starting location sharing...");

      const res = await fetch(apiUrl("/api/checkin/start/"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          contactIds: selectedContacts,
          intervalMinutes: interval,
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      setStartPhase("Informing your contacts...");
      await new Promise(r => setTimeout(r, 500));

      setActiveCheckIn(data.checkin);
      setShowSetup(false);
      toast.success("Safety Check-In started! Your contacts have been notified.");
    } catch (err: any) {
      toast.danger(err.message || "Failed to start check-in");
    } finally {
      setStarting(false);
      setStartPhase(null);
    }
  };

 const handleConfirm = async () => {
    if (!activeCheckIn) return;

    // Optimistic: update UI immediately
    const newNextCheckIn = new Date(Date.now() + activeCheckIn.check_in_interval_minutes * 60000).toISOString();
    setActiveCheckIn(prev => prev ? {
      ...prev,
      status: "active",
      next_check_in_at: newNextCheckIn,
      last_confirmed_at: new Date().toISOString(),
      missed_count: 0,
    } : null);
    setIsOverdue(false);
    setWarned(false);
    setExpired(false);
    toast.success("Checked in! Timer reset.");

    // Background: send to server + get location
    try {
      let lat, lng;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {}

      const res = await fetch(apiUrl("/api/checkin/confirm/"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });

      const data = await res.json();
      if (data.ok && data.nextCheckInAt) {
        setActiveCheckIn(prev => prev ? { ...prev, next_check_in_at: data.nextCheckInAt } : null);
      }
    } catch {}
  };

const handleCancel = async () => {
    // Block any updates from realtime/polling during cancel
    cancellingRef.current = true;
    const prevCheckIn = activeCheckIn;
    setActiveCheckIn(null);
    setShowCancelConfirm(false);
    toast.success("Check-in ended. Contacts notified.");

    // Background: send to server
    try {
      await fetch(apiUrl("/api/checkin/cancel/"), {
        method: "POST",
        headers: headers(),
      });
} catch {
      // Revert if failed
      cancellingRef.current = false;
      setActiveCheckIn(prevCheckIn);
      toast.danger("Failed to cancel. Try again.");
      return;
    }
    // Keep blocking for 3 seconds to prevent flash from realtime/polling
    setTimeout(() => { cancellingRef.current = false; }, 3000);
  };

  const toggleContact = (contactUserId: string) => {
    setSelectedContacts(prev =>
      prev.includes(contactUserId)
        ? prev.filter(id => id !== contactUserId)
        : [...prev, contactUserId]
    );
  };

  const selectAll = () => {
    if (selectedContacts.length === acceptedContacts.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(acceptedContacts.map(c => c.contact_user_id));
    }
  };

if (checkingStatus) {
    return (
      <div
        className="w-full mb-6 p-4 rounded-2xl animate-pulse"
        style={{
          background: "rgba(139, 92, 246, 0.05)",
          border: "1px solid rgba(139, 92, 246, 0.1)",
          height: 72,
        }}
      />
    );
  }

  // Active check-in banner
  if (activeCheckIn) {
    return (
      <>
        <div
          className={`mb-6 rounded-2xl overflow-hidden ${
            isOverdue
              ? "bg-red-500/15 border border-red-500/30"
              : "bg-green-500/10 border border-green-500/25"
          }`}
        >
          {/* Status header */}
          <div className="px-4 py-3 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              isOverdue ? "bg-red-500/20" : "bg-green-500/20"
            }`}>
              {isOverdue ? (
                <AlertTriangle className="w-5 h-5 text-red-400" />
              ) : (
                <Radio className="w-5 h-5 text-green-400 animate-pulse" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${isOverdue ? "text-red-400" : "text-green-400"}`}>
                {isOverdue ? "Check-In Overdue!" : "Sharing Location"}
              </p>
              <p className="text-xs text-dark-400">
                {isOverdue
                  ? "Your contacts have been notified. Tap below to confirm you are okay."
                  : `Next check-in in ${timeLeft}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-lg font-bold ${isOverdue ? "text-red-400" : "text-green-400"}`}>
                {timeLeft}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="px-4 pb-3 flex gap-2">
            <button
              onClick={handleConfirm}
              className={`flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                isOverdue
                  ? "bg-red-600 text-white"
                  : "bg-green-600 text-white"
              }`}
            >
              <CheckCircle className="w-4 h-4" />
              I'm OK
            </button>
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="px-4 py-3 rounded-xl text-sm font-medium glass-sm text-dark-300 hover:bg-white/10"
            >
              Stop
            </button>
          </div>
        </div>

        {/* Cancel confirmation */}
        {showCancelConfirm && (
          <>
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={() => setShowCancelConfirm(false)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div
                className="w-full max-w-sm rounded-2xl p-6"
                style={{
                  background: "rgba(18, 12, 36, 0.98)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold text-white mb-2">Stop Sharing Location?</h3>
                <p className="text-sm text-dark-400 mb-4">
                  Your emergency contacts will be notified that you stopped sharing. You can start a new check-in anytime.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium glass-sm text-dark-200 hover:bg-white/10"
                  >
                    Keep Sharing
                  </button>
                  <button
                    onClick={handleCancel}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-500 flex items-center justify-center gap-2"
                  >
                    Stop Sharing
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  // Start button (no active check-in)
  return (
    <>
      <button
        onClick={() => {
          if (acceptedContacts.length === 0) {
            toast.warning("Add and get at least one emergency contact accepted first.");
            return;
          }
          setShowSetup(true);
          setSelectedContacts([]);
        }}
        className="w-full mb-6 p-4 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.98] hover:bg-white/5"
        style={{
          background: "rgba(139, 92, 246, 0.08)",
          border: "1px solid rgba(139, 92, 246, 0.2)",
        }}
      >
           <div className="w-11 h-11 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5 text-primary-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-primary-400">Safety Check-In</p>
          <p className="text-xs text-dark-400">Share your live location with emergency contacts</p>
        </div>
        <ChevronRight className="w-5 h-5 text-dark-500" />
      </button>

      {/* Setup Modal */}
      {showSetup && (
        <>
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" onClick={() => setShowSetup(false)} />
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div
              className="w-full max-w-md rounded-t-3xl sm:rounded-2xl max-h-[85vh] overflow-y-auto"
              style={{
                background: "rgba(18, 12, 36, 0.98)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 -10px 40px rgba(0,0,0,0.5)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Handle bar (mobile) */}
              <div className="flex justify-center pt-3 pb-1 sm:hidden">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>

              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-white">Safety Check-In</h2>
                    <p className="text-sm text-dark-400">Share your location and set a check-in timer</p>
                  </div>
                  <button onClick={() => setShowSetup(false)} className="p-1.5 rounded-lg hover:bg-white/10">
                    <X className="w-5 h-5 text-dark-400" />
                  </button>
                </div>

                {/* Select contacts */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-dark-200">
                      <Users className="w-4 h-4 inline mr-1.5" />
                      Share with
                    </label>
                    <button
                      onClick={selectAll}
                      className="text-xs text-primary-400 hover:text-primary-300"
                    >
                      {selectedContacts.length === acceptedContacts.length ? "Deselect All" : "Select All"}
                    </button>
                  </div>

                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {acceptedContacts.map(contact => {
                      const isSelected = selectedContacts.includes(contact.contact_user_id);
                      return (
                        <button
                          key={contact.id}
                          onClick={() => toggleContact(contact.contact_user_id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left ${
                            isSelected
                              ? "bg-primary-600/15 border border-primary-500/30"
                              : "bg-white/5 border border-white/5 hover:bg-white/10"
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                            isSelected ? "bg-primary-600" : "border border-dark-500"
                          }`}>
                            {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                          </div>
                          <div className="w-8 h-8 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden">
                            {contact.avatar_url ? (
                              <img src={contact.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs font-bold text-primary-400">{contact.full_name[0]}</span>
                            )}
                          </div>
                          <span className="text-sm text-dark-100">{contact.full_name}</span>
                        </button>
                      );
                    })}
                  </div>

                  {acceptedContacts.length === 0 && (
                    <p className="text-sm text-dark-500 text-center py-4">No accepted contacts yet</p>
                  )}
                </div>

                {/* Timer selection */}
                <div className="mb-6">
                  <label className="text-sm font-medium text-dark-200 mb-3 block">
                    <Clock className="w-4 h-4 inline mr-1.5" />
                    Check-in every
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {INTERVAL_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setInterval_(opt.value)}
                        className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                          interval === opt.value
                            ? "bg-primary-600 text-white"
                            : "glass-sm text-dark-300 hover:bg-white/10"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-dark-500 mt-2">
                    You will need to tap "I'm OK" within this time, or your contacts will be alerted.
                  </p>
                </div>

                {/* How it works */}
                <div className="p-3 rounded-xl bg-primary-500/10 border border-primary-500/15 mb-6">
                  <p className="text-xs text-primary-400 font-medium mb-1.5">How it works</p>
                  <div className="space-y-1 text-xs text-dark-400">
                    <p>1. Your selected contacts are notified and can see your live location</p>
                    <p>2. A timer starts. Tap "I'm OK" before it expires to reset</p>
                    <p>3. If you miss the timer, contacts are alerted with next steps</p>
                    <p>4. Location sharing continues until you stop it</p>
                  </div>
                </div>

                {/* Loading overlay */}
                {starting && startPhase && (
                  <div className="mb-4 p-4 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-600/30 flex items-center justify-center shrink-0">
                      <Loader2 className="w-4 h-4 text-primary-400 animate-spin" />
                    </div>
                    <p className="text-sm text-primary-400 font-medium">{startPhase}</p>
                  </div>
                )}

                {/* Start button */}
                <button
                  onClick={handleStart}
                  disabled={starting || selectedContacts.length === 0}
                  className="w-full py-4 rounded-xl font-semibold text-white disabled:opacity-50 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  style={{
                    background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                    boxShadow: "0 4px 20px rgba(124, 58, 237, 0.3)",
                  }}
                >
                  {starting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Shield className="w-5 h-5" />
                  )}
                  Start Safety Check-In
                </button>

                <p className="text-[11px] text-dark-600 text-center mt-3">
                  {selectedContacts.length} contact{selectedContacts.length !== 1 ? "s" : ""} selected
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}