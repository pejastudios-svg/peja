"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { AlertTriangle, X, Phone, Loader2, CheckCircle, MessageCircle } from "lucide-react";

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
  const [smsSent, setSmsSent] = useState(false);
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

  const sendSOSSMS = async (contacts: any[], userName: string, address: string, lat: number, lng: number) => {
    const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
    
    const message = `🚨 PEJA SOS ALERT 🚨

${userName} needs immediate help!

📍 Location: ${address}
🗺️ Map: ${mapLink}

Please respond immediately or contact emergency services.

⚠️ Peja will NEVER ask for money. Any payment request is a SCAM.`;

    let successCount = 0;
    
    for (const contact of contacts) {
      try {
        // Format phone number
        let phone = contact.phone.replace(/\s+/g, '').replace(/^0/, '234');
        if (!phone.startsWith('234') && !phone.startsWith('+')) {
          phone = '234' + phone;
        }
        phone = phone.replace('+', '');

        // Call Termii API directly (you can also use an API route)
        const response = await fetch('https://api.ng.termii.com/api/sms/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: phone,
            from: 'N-Alert', // Use N-Alert for DND numbers or your registered sender ID
            sms: message,
            type: 'plain',
            channel: 'dnd', // Use 'dnd' channel to reach DND numbers
            api_key: process.env.NEXT_PUBLIC_TERMII_API_KEY,
          }),
        });

        const result = await response.json();
        
        if (result.code === 'ok') {
          successCount++;
          
          // Log SMS in database
          await supabase.from("sms_logs").insert({
            sos_id: sosId,
            recipient_phone: contact.phone,
            recipient_name: contact.name,
            message: message,
            status: 'sent',
            provider_response: result,
          });
        } else {
          await supabase.from("sms_logs").insert({
            sos_id: sosId,
            recipient_phone: contact.phone,
            recipient_name: contact.name,
            message: message,
            status: 'failed',
            provider_response: result,
          });
        }
      } catch (error) {
        console.error(`Failed to send SMS to ${contact.name}:`, error);
      }
    }

    return successCount;
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
        const sentCount = await sendSOSSMS(contacts, userName, address, latitude, longitude);
        
        if (sentCount > 0) {
          setSmsSent(true);
        } else {
          setSmsError("Could not send SMS. Please call your contacts directly.");
        }
      } else {
        setSmsError("No emergency contacts set up. Please add contacts in Settings.");
      }

      setShowConfirmation(true);
      setTimeout(() => setShowConfirmation(false), 5000);

    } catch (error) {
      console.error("Error triggering SOS:", error);
      alert("Could not send SOS. Please try again or call emergency services directly.");
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
      setSmsSent(false);
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
            {smsSent 
              ? "✅ SMS sent to your emergency contacts. Help is on the way!"
              : "Your location is being shared. Call emergency services if needed."}
          </p>

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
              {smsSent 
                ? "Emergency contacts have been notified via SMS."
                : "Your location is being shared."}
            </p>
            <p className="text-xs text-dark-500">
              ⚠️ Peja will NEVER ask for money. Any payment request is a SCAM.
            </p>
          </div>
        </div>
      )}
    </>
  );
}