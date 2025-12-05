"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { AlertTriangle, X, Phone, Loader2, CheckCircle } from "lucide-react";

interface SOSButtonProps {
  className?: string;
}

export function SOSButton({ className = "" }: SOSButtonProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [sosActive, setSosActive] = useState(false);
  const [sosId, setSosId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [smsStatus, setSmsStatus] = useState<{ sent: number; failed: number; total: number }>({ sent: 0, failed: 0, total: 0 });
  
  const holdTimer = useRef<NodeJS.Timeout | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  const HOLD_DURATION = 3000;

  useEffect(() => {
    if (user) {
      checkActiveSOS();
    }
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

  const getAddressFromCoords = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
        { headers: { "User-Agent": "Peja App" } }
      );
      const data = await response.json();
      if (data?.address) {
        const addr = data.address;
        const parts = [];
        if (addr.road) parts.push(addr.road);
        if (addr.neighbourhood || addr.suburb) parts.push(addr.neighbourhood || addr.suburb);
        if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
        if (addr.state) parts.push(addr.state);
        return parts.join(", ") || data.display_name || "Unknown location";
      }
      return "Unknown location";
    } catch {
      return "Unknown location";
    }
  };

  const sendSOSSMS = async (
    contacts: any[], 
    userName: string, 
    address: string, 
    lat: number, 
    lng: number,
    alertId: string
  ) => {
    const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
    
    // Keep message short for better delivery
    const message = `🚨 SOS ALERT - ${userName} needs help!

📍 ${address}
🗺️ ${mapLink}

⚠️ Peja will NEVER ask for money.`;

    let sentCount = 0;
    let failedCount = 0;
    
    for (const contact of contacts) {
      try {
        const response = await fetch('/api/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: contact.phone,
            message: message,
            recipientName: contact.name,
          }),
        });

        const result = await response.json();
        
        if (result.success) {
          sentCount++;
          console.log(`✅ SMS sent to ${contact.name}`);
        } else {
          failedCount++;
          console.error(`❌ SMS failed for ${contact.name}:`, result.error);
        }

        // Log to database
        await supabase.from("sms_logs").insert({
          sos_id: alertId,
          recipient_phone: contact.phone,
          recipient_name: contact.name,
          message: message,
          status: result.success ? 'sent' : 'failed',
          provider_response: result,
        }).catch(() => {}); // Don't fail if logging fails

      } catch (error) {
        failedCount++;
        console.error(`❌ SMS error for ${contact.name}:`, error);
      }
    }

    return { sent: sentCount, failed: failedCount, total: contacts.length };
  };

  const handleHoldStart = () => {
    if (!user) {
      router.push("/login");
      return;
    }

    if (sosActive || loading) return;

    setIsHolding(true);
    setHoldProgress(0);

    const startTime = Date.now();
    progressInterval.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / HOLD_DURATION) * 100, 100);
      setHoldProgress(progress);
      if (progress >= 100) {
        if (progressInterval.current) clearInterval(progressInterval.current);
      }
    }, 50);

    holdTimer.current = setTimeout(() => {
      triggerSOS();
    }, HOLD_DURATION);
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
    setHoldProgress(0);

    try {
      // Get location
      let latitude = 6.5244; // Default Lagos
      let longitude = 3.3792;
      let address = "Location unavailable";

      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
        address = await getAddressFromCoords(latitude, longitude);
      } catch (locError) {
        console.warn("Could not get location:", locError);
      }

      // Create SOS alert
      const { data: sosData, error: sosError } = await supabase
        .from("sos_alerts")
        .insert({
          user_id: user.id,
          latitude,
          longitude,
          address,
          status: "active",
        })
        .select()
        .single();

      if (sosError) throw sosError;

      setSosActive(true);
      setSosId(sosData.id);

      // Get emergency contacts
      const { data: contacts } = await supabase
        .from("emergency_contacts")
        .select("*")
        .eq("user_id", user.id);

      if (contacts && contacts.length > 0) {
        // Get user's name
        const { data: userData } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", user.id)
          .single();

        const userName = userData?.full_name || "Someone";

        // Send SMS
        const result = await sendSOSSMS(contacts, userName, address, latitude, longitude, sosData.id);
        setSmsStatus(result);
      } else {
        setSmsStatus({ sent: 0, failed: 0, total: 0 });
      }

      setShowConfirmation(true);
      setTimeout(() => setShowConfirmation(false), 5000);

    } catch (error) {
      console.error("Error triggering SOS:", error);
      alert("Could not send SOS. Please call emergency services directly: 112 or 767");
    } finally {
      setLoading(false);
    }
  };

  const cancelSOS = async () => {
    if (!sosId) return;

    setLoading(true);
    try {
      await supabase
        .from("sos_alerts")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("id", sosId);

      setSosActive(false);
      setSosId(null);
      setSmsStatus({ sent: 0, failed: 0, total: 0 });
    } catch (error) {
      console.error("Error cancelling SOS:", error);
    } finally {
      setLoading(false);
    }
  };

  // Active SOS view
  if (sosActive) {
    return (
      <div className={`fixed bottom-24 left-4 right-4 z-50 ${className}`}>
        <div className="glass-card border border-red-500/50 bg-red-500/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-400 font-semibold">SOS Active</span>
            </div>
            <button onClick={cancelSOS} disabled={loading} className="text-dark-400 hover:text-dark-200">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />}
            </button>
          </div>

          {smsStatus.total > 0 && (
            <p className="text-sm text-dark-300 mb-3">
              {smsStatus.sent > 0 
                ? `✅ SMS sent to ${smsStatus.sent}/${smsStatus.total} contacts`
                : `⚠️ Could not send SMS. Please call your contacts directly.`
              }
            </p>
          )}

          {smsStatus.total === 0 && (
            <p className="text-sm text-orange-400 mb-3">
              ⚠️ No emergency contacts set up. Add contacts in Settings.
            </p>
          )}

          <div className="flex gap-2">
            <a href="tel:112" className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600 text-white rounded-lg font-medium">
              <Phone className="w-4 h-4" />
              Call 112
            </a>
            <a href="tel:767" className="flex-1 flex items-center justify-center gap-2 py-2.5 glass-sm text-dark-200 rounded-lg font-medium">
              <Phone className="w-4 h-4" />
              Call 767
            </a>
          </div>

          <button onClick={cancelSOS} disabled={loading} className="w-full mt-3 py-2 text-sm text-dark-400 hover:text-dark-200">
            Cancel SOS (I'm safe)
          </button>
          
          <p className="text-xs text-dark-500 mt-3 text-center">
            ⚠️ Peja will NEVER ask for money. Any payment request is a SCAM.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* SOS Button */}
      <button
        onMouseDown={handleHoldStart}
        onMouseUp={handleHoldEnd}
        onMouseLeave={handleHoldEnd}
        onTouchStart={handleHoldStart}
        onTouchEnd={handleHoldEnd}
        disabled={loading}
        className={`
          relative w-16 h-16 rounded-full 
          bg-gradient-to-br from-red-500 to-red-700
          shadow-lg shadow-red-500/30
          flex items-center justify-center
          transition-transform active:scale-95
          ${isHolding ? "scale-110" : ""}
          ${className}
        `}
      >
        {isHolding && (
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
            <circle 
              cx="50" cy="50" r="46" 
              fill="none" 
              stroke="white" 
              strokeWidth="4" 
              strokeDasharray={`${holdProgress * 2.89} 289`} 
              strokeLinecap="round" 
            />
          </svg>
        )}
        {loading ? (
          <Loader2 className="w-7 h-7 text-white animate-spin" />
        ) : (
          <AlertTriangle className="w-7 h-7 text-white" />
        )}
      </button>

      {/* Hold instruction */}
      {isHolding && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 z-50">
          <div className="glass-card py-2 px-4 text-center">
            <p className="text-white text-sm font-medium">
              Hold for {Math.ceil((HOLD_DURATION - (holdProgress / 100 * HOLD_DURATION)) / 1000)}s...
            </p>
          </div>
        </div>
      )}

      {/* Confirmation popup */}
      {showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowConfirmation(false)} />
          <div className="relative glass-card text-center max-w-sm">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-dark-100 mb-2">SOS Activated!</h3>
            <p className="text-dark-400 text-sm mb-2">
              {smsStatus.sent > 0 
                ? `${smsStatus.sent} emergency contact(s) notified via SMS.`
                : "Your location is being shared."
              }
            </p>
            <p className="text-xs text-dark-500">
              ⚠️ Peja will NEVER ask for money.
            </p>
          </div>
        </div>
      )}
    </>
  );
}