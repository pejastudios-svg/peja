// src/components/sos/SOSButton.tsx
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
  const [smsResults, setSmsResults] = useState<{ sent: number; failed: number }>({ sent: 0, failed: 0 });
  const [smsError, setSmsError] = useState("");
  
  const holdTimer = useRef<NodeJS.Timeout | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  const HOLD_DURATION = 3000;

  useEffect(() => {
    checkActiveSOS();
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
      return data.display_name || "Unknown location";
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
    sosAlertId: string
  ) => {
    const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
    
    const message = `🚨 PEJA SOS ALERT 🚨

${userName} needs immediate help!

📍 Location: ${address}
🗺️ Map: ${mapLink}

Please respond immediately or contact emergency services.

⚠️ Peja will NEVER ask for money. Any payment request is a SCAM.`;

    let sentCount = 0;
    let failedCount = 0;
    
    for (const contact of contacts) {
      try {
        // Call our API route instead of Termii directly
        const response = await fetch("/api/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: contact.phone,
            message: message,
            recipientName: contact.name,
          }),
        });

        const result = await response.json();
        
        // Log to database
        await supabase.from("sms_logs").insert({
          sos_id: sosAlertId,
          recipient_phone: contact.phone,
          recipient_name: contact.name,
          message: message,
          status: result.success ? "sent" : "failed",
          provider_response: result,
          error_message: result.error || null,
        });
        
        if (result.success) {
          sentCount++;
          console.log(`SMS sent to ${contact.name}`);
        } else {
          failedCount++;
          console.error(`Failed to send SMS to ${contact.name}:`, result.error);
        }
      } catch (error) {
        failedCount++;
        console.error(`Failed to send SMS to ${contact.name}:`, error);
        
        await supabase.from("sms_logs").insert({
          sos_id: sosAlertId,
          recipient_phone: contact.phone,
          recipient_name: contact.name,
          message: message,
          status: "failed",
          error_message: String(error),
        });
      }
    }

    return { sent: sentCount, failed: failedCount };
  };

  const handleHoldStart = () => {
    if (!user) {
      router.push("/login");
      return;
    }

    if (sosActive) return;

    setIsHolding(true);
    setHoldProgress(0);

    const startTime = Date.now();
    progressInterval.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / HOLD_DURATION) * 100, 100);
      setHoldProgress(progress);
      if (progress >= 100) clearInterval(progressInterval.current!);
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
    setSmsError("");
    setSmsResults({ sent: 0, failed: 0 });

    try {
      // Get location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const { latitude, longitude } = position.coords;
      const address = await getAddressFromCoords(latitude, longitude);

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

        const userName = userData?.full_name || "A Peja user";

        // Send SMS to all contacts
        const results = await sendSOSSMS(contacts, userName, address, latitude, longitude, sosData.id);
        setSmsResults(results);
        
        if (results.sent === 0) {
          setSmsError("Could not send SMS. Please call your contacts directly.");
        }
      } else {
        setSmsError("No emergency contacts set up. Go to Settings to add contacts.");
      }

      // Create notification for admins
      const { data: admins } = await supabase
        .from("users")
        .select("id")
        .eq("is_admin", true);
      
      if (admins) {
        for (const admin of admins) {
          await supabase.from("notifications").insert({
            user_id: admin.id,
            type: "sos_alert",
            title: "🚨 SOS Alert Triggered",
            body: `User ${user.email} triggered an SOS alert at ${address}`,
            data: { sos_id: sosData.id, latitude, longitude },
          });
        }
      }

      setShowConfirmation(true);
      setTimeout(() => setShowConfirmation(false), 5000);

    } catch (error: any) {
      console.error("Error triggering SOS:", error);
      if (error.code === 1) {
        alert("Location access denied. Please enable location services.");
      } else if (error.code === 3) {
        alert("Location request timed out. Please try again.");
      } else {
        alert("Could not send SOS. Please try again or call emergency services directly.");
      }
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
      setSmsResults({ sent: 0, failed: 0 });
      setSmsError("");
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

          <p className="text-sm text-dark-300 mb-3">
            {smsResults.sent > 0 
              ? `✅ SMS sent to ${smsResults.sent} contact(s). Help is on the way!`
              : "Your location is being shared. Call emergency services if needed."}
          </p>

          {smsResults.failed > 0 && (
            <p className="text-sm text-orange-400 mb-2">
              ⚠️ {smsResults.failed} SMS failed to send.
            </p>
          )}

          {smsError && (
            <p className="text-sm text-orange-400 mb-3">⚠️ {smsError}</p>
          )}

          <div className="flex gap-2">
            <a href="tel:112" className="flex-1 flex items-center justify-center gap-2 py-2 bg-red-600 text-white rounded-lg font-medium">
              <Phone className="w-4 h-4" />
              Call 112
            </a>
            <a href="tel:767" className="flex-1 flex items-center justify-center gap-2 py-2 glass-sm text-dark-200 rounded-lg font-medium">
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
            <circle cx="50" cy="50" r="46" fill="none" stroke="white" strokeWidth="4" strokeDasharray={`${holdProgress * 2.89} 289`} strokeLinecap="round" />
          </svg>
        )}
        {loading ? <Loader2 className="w-7 h-7 text-white animate-spin" /> : <AlertTriangle className="w-7 h-7 text-white" />}
      </button>

      {/* Hold instruction */}
      {isHolding && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 z-50">
          <div className="glass-card py-2 px-4 text-center">
            <p className="text-white text-sm font-medium">Hold for {Math.ceil((HOLD_DURATION - (holdProgress / 100 * HOLD_DURATION)) / 1000)}s...</p>
          </div>
        </div>
      )}

      {/* Confirmation popup */}
      {showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative glass-card text-center max-w-sm">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold text-dark-100 mb-2">SOS Sent!</h3>
            <p className="text-dark-400 text-sm mb-2">
              {smsResults.sent > 0 
                ? `${smsResults.sent} emergency contact(s) have been notified via SMS.`
                : "Your location is being shared."}
            </p>
            {smsResults.failed > 0 && (
              <p className="text-orange-400 text-sm mb-2">
                {smsResults.failed} SMS failed. Call them directly.
              </p>
            )}
            <p className="text-xs text-dark-500">
              ⚠️ Peja will NEVER ask for money. Any payment request is a SCAM.
            </p>
          </div>
        </div>
      )}
    </>
  );
}