"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { AlertTriangle, X, Phone, Loader2, CheckCircle } from "lucide-react";

export function SOSButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [sosActive, setSosActive] = useState(false);
  const [sosId, setSosId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [smsStatus, setSmsStatus] = useState({ sent: 0, total: 0 });

  const holdTimer = useRef<NodeJS.Timeout | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const HOLD_DURATION = 3000;

  useEffect(() => {
    if (user) checkActiveSOS();
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, [user]);

  const checkActiveSOS = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("sos_alerts")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (data) {
      setSosActive(true);
      setSosId(data.id);
    }
  };

  const getAddress = async (lat: number, lng: number): Promise<string> => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
        { headers: { "User-Agent": "Peja App" } }
      );
      const data = await res.json();
      return data?.display_name?.split(",").slice(0, 3).join(",") || "Unknown location";
    } catch {
      return "Unknown location";
    }
  };

  const sendSMS = async (contacts: any[], userName: string, address: string, lat: number, lng: number, alertId: string) => {
    const mapLink = `https://maps.google.com/?q=${lat},${lng}`;
    const message = `🚨 SOS - ${userName} needs help!\n📍 ${address}\n🗺️ ${mapLink}\n⚠️ Peja never asks for money.`;

    let sentCount = 0;

    for (const contact of contacts) {
      try {
        const res = await fetch("/api/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: contact.phone, message, recipientName: contact.name }),
        });
        const result = await res.json();
        if (result.success) sentCount++;

        // Log SMS - wrapped in try/catch (no .catch() chaining)
        try {
          await supabase.from("sms_logs").insert({
            sos_id: alertId,
            recipient_phone: contact.phone,
            recipient_name: contact.name,
            message,
            status: result.success ? "sent" : "failed",
            provider_response: result,
          });
        } catch (logError) {
          console.warn("SMS log failed:", logError);
        }
      } catch (err) {
        console.error(`SMS to ${contact.name} failed:`, err);
      }
    }

    return { sent: sentCount, total: contacts.length };
  };

  const handleHoldStart = () => {
    if (!user) { router.push("/login"); return; }
    if (sosActive || loading) return;

    setIsHolding(true);
    setHoldProgress(0);

    const start = Date.now();
    progressInterval.current = setInterval(() => {
      const p = Math.min(((Date.now() - start) / HOLD_DURATION) * 100, 100);
      setHoldProgress(p);
      if (p >= 100) clearInterval(progressInterval.current!);
    }, 50);

    holdTimer.current = setTimeout(triggerSOS, HOLD_DURATION);
  };

  const handleHoldEnd = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (progressInterval.current) clearInterval(progressInterval.current);
    setIsHolding(false);
    setHoldProgress(0);
  };

  const triggerSOS = async () => {
    if (!user) return;
    setLoading(true);
    setIsHolding(false);

    try {
      let lat = 6.5244, lng = 3.3792, address = "Location unavailable";
      
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        address = await getAddress(lat, lng);
      } catch {}

      const { data: sosData, error } = await supabase
        .from("sos_alerts")
        .insert({ user_id: user.id, latitude: lat, longitude: lng, address, status: "active" })
        .select()
        .single();

      if (error) throw error;

      setSosActive(true);
      setSosId(sosData.id);

      const { data: contacts } = await supabase
        .from("emergency_contacts")
        .select("*")
        .eq("user_id", user.id);

      if (contacts?.length) {
        const { data: userData } = await supabase.from("users").select("full_name").eq("id", user.id).single();
        const result = await sendSMS(contacts, userData?.full_name || "Someone", address, lat, lng, sosData.id);
        setSmsStatus(result);
      }

      setShowConfirmation(true);
      setTimeout(() => setShowConfirmation(false), 5000);
    } catch (err) {
      console.error("SOS error:", err);
      alert("SOS failed. Call 112 or 767 directly.");
    } finally {
      setLoading(false);
    }
  };

  const cancelSOS = async () => {
    if (!sosId) return;
    setLoading(true);
    try {
      await supabase.from("sos_alerts").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("id", sosId);
      setSosActive(false);
      setSosId(null);
    } catch {} finally {
      setLoading(false);
    }
  };

  if (sosActive) {
    return (
      <div className={`fixed bottom-24 left-4 right-4 z-50 ${className}`}>
        <div className="glass-card border border-red-500/50 bg-red-500/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-400 font-semibold">SOS Active</span>
            </div>
            <button onClick={cancelSOS} disabled={loading}>
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5 text-dark-400" />}
            </button>
          </div>
          <p className="text-sm text-dark-300 mb-3">
            {smsStatus.sent > 0 ? `✅ SMS sent to ${smsStatus.sent}/${smsStatus.total} contacts` : "⚠️ Call your contacts directly"}
          </p>
          <div className="flex gap-2">
            <a href="tel:112" className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600 text-white rounded-lg font-medium">
              <Phone className="w-4 h-4" /> 112
            </a>
            <a href="tel:767" className="flex-1 flex items-center justify-center gap-2 py-2.5 glass-sm text-dark-200 rounded-lg font-medium">
              <Phone className="w-4 h-4" /> 767
            </a>
          </div>
          <button onClick={cancelSOS} className="w-full mt-3 py-2 text-sm text-dark-400">Cancel (I'm safe)</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onMouseDown={handleHoldStart}
        onMouseUp={handleHoldEnd}
        onMouseLeave={handleHoldEnd}
        onTouchStart={handleHoldStart}
        onTouchEnd={handleHoldEnd}
        disabled={loading}
        className={`relative w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-red-700 shadow-lg flex items-center justify-center ${isHolding ? "scale-110" : ""} ${className}`}
      >
        {isHolding && (
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
            <circle cx="50" cy="50" r="46" fill="none" stroke="white" strokeWidth="4" strokeDasharray={`${holdProgress * 2.89} 289`} strokeLinecap="round" />
          </svg>
        )}
        {loading ? <Loader2 className="w-7 h-7 text-white animate-spin" /> : <AlertTriangle className="w-7 h-7 text-white" />}
      </button>

      {isHolding && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 z-50 glass-card py-2 px-4">
          <p className="text-white text-sm">Hold {Math.ceil((HOLD_DURATION - holdProgress / 100 * HOLD_DURATION) / 1000)}s...</p>
        </div>
      )}

      {showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowConfirmation(false)} />
          <div className="relative glass-card text-center max-w-sm">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-dark-100 mb-2">SOS Sent!</h3>
            <p className="text-dark-400 text-sm">{smsStatus.sent > 0 ? `${smsStatus.sent} contacts notified` : "Location shared"}</p>
          </div>
        </div>
      )}
    </>
  );
}