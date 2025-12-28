"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { createNotification } from "@/lib/notifications";
import { Portal } from "@/components/ui/Portal";
import { 
  AlertTriangle, X, Phone, Loader2, CheckCircle, Users, 
  Mic, Square, ChevronRight, ArrowLeft
} from "lucide-react";

// SOS Tags - Professional, no emojis
const SOS_TAGS = [
  { id: "medical", label: "Medical Emergency", suggestion: "Call an ambulance or get the person to a hospital immediately. If trained, provide first aid." },
  { id: "accident", label: "Car Accident", suggestion: "Check for injuries, call emergency services, and do not move the injured unless there is immediate danger." },
  { id: "robbery", label: "Armed Robbery", suggestion: "DANGER: Do NOT approach. Contact police immediately at 112 or 767. Stay safe and observe from a distance." },
  { id: "kidnapping", label: "Kidnapping", suggestion: "EXTREME DANGER: Do NOT approach. Contact police immediately. Do not attempt rescue alone." },
  { id: "fire", label: "Fire", suggestion: "Call fire service. Evacuate the area immediately. Do not enter burning buildings." },
  { id: "assault", label: "Physical Assault", suggestion: "Ensure the scene is safe before approaching. Call police and provide first aid if you are trained." },
  { id: "flood", label: "Flooding", suggestion: "Avoid flooded areas. Help evacuate people to higher ground if safe to do so." },
  { id: "stuck", label: "Stuck or Stranded", suggestion: "User may need transport or mechanical help. Safe to approach and assist." },
  { id: "health", label: "Health Crisis", suggestion: "Person may need medication or medical attention. Ask before administering any help." },
  { id: "other", label: "Other Emergency", suggestion: "Assess the situation carefully before providing help. Your safety comes first." },
];

type SOSTagId = typeof SOS_TAGS[number]["id"];

export function SOSButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  
  // Core states
  const [sosActive, setSosActive] = useState(false);
  const [sosId, setSosId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState({ contacts: 0, nearby: 0 });

  // Flow states
  const [showOptions, setShowOptions] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showActivePopup, setShowActivePopup] = useState(false);

  // Tag and message
  const [selectedTag, setSelectedTag] = useState<SOSTagId | null>(null);
  const [textMessage, setTextMessage] = useState("");
  
  // Voice note
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

// iPhone fallback: if MediaRecorder isn't supported, use file input
const supportsMediaRecorder =
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

  const handleAudioFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  // cleanup old preview url
  if (audioUrl) URL.revokeObjectURL(audioUrl);

  setAudioFile(file);
  setAudioBlob(null);
  setAudioUrl(URL.createObjectURL(file));

  e.target.value = "";
};
  
  const holdTimer = useRef<NodeJS.Timeout | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recordingInterval = useRef<NodeJS.Timeout | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  
  const HOLD_DURATION = 3000;
  const MAX_RECORDING_TIME = 30;

  useEffect(() => {
    if (user) checkActiveSOS();
    return () => cleanup();
  }, [user]);

  // Add this useEffect after the first one
useEffect(() => {
  if (!sosActive || !sosId) return;
  if (!navigator.geolocation) return;

  let lastSent = 0;

  const watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const now = Date.now();
      // throttle DB updates (every 8 seconds)
      if (now - lastSent < 8000) return;
      lastSent = now;

      try {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const address = await getAddress(lat, lng);

        await supabase
          .from("sos_alerts")
          .update({
            latitude: lat,
            longitude: lng,
            address,
            last_updated: new Date().toISOString(),
          })
          .eq("id", sosId);
      } catch (err) {
        console.warn("SOS location update failed:", err);
      }
    },
    (err) => {
      // don’t spam console
      console.warn("SOS watchPosition error:", err.code, err.message);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );

  return () => {
    navigator.geolocation.clearWatch(watchId);
  };
}, [sosActive, sosId]);

  const cleanup = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (recordingInterval.current) clearInterval(recordingInterval.current);
    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      mediaRecorder.current.stop();
    }
  };

  const checkActiveSOS = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("sos_alerts")
      .select("id, tag, message")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    
    if (data) {
      setSosActive(true);
      setSosId(data.id);
      if (data.tag) setSelectedTag(data.tag);
      if (data.message) setTextMessage(data.message);
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

  // Voice Recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.current.push(e.data);
        }
      };

      mediaRecorder.current.onstop = () => {
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingInterval.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= MAX_RECORDING_TIME - 1) {
            stopRecording();
            return MAX_RECORDING_TIME;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err) {
      console.error("Microphone error:", err);
      alert("Could not access microphone. Please grant permission.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      mediaRecorder.current.stop();
    }
    if (recordingInterval.current) {
      clearInterval(recordingInterval.current);
    }
    setIsRecording(false);
  };

const removeRecording = () => {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  setAudioBlob(null);
  setAudioFile(null);
  setAudioUrl(null);
  setRecordingTime(0);
};

const notifyContacts = async (
  userName: string,
  address: string,
  sosId: string,
  payload: {
    tag?: SOSTagId | null;
    message?: string | null;
    latitude: number;
    longitude: number;
  }
) => {    if (!user) return 0;

const tagId = payload.tag ?? null;
const tagInfo = tagId ? SOS_TAGS.find(t => t.id === tagId) : null;

    const { data: contacts } = await supabase
      .from("emergency_contacts")
      .select("contact_user_id")
      .eq("user_id", user.id)
      .not("contact_user_id", "is", null);

    if (!contacts?.length) return 0;

    let notifiedCount = 0;
    for (const contact of contacts) {
      if (contact.contact_user_id) {
        const success = await createNotification({
          userId: contact.contact_user_id,
          type: "sos_alert",
          title: `SOS Alert: ${tagInfo?.label || "Emergency"}`,
          body: `${userName} needs immediate help at ${address}`,
          data: {
          sos_id: sosId,
          tag: payload.tag || null,
          message: payload.message || null,
          address,
          latitude: payload.latitude,
          longitude: payload.longitude,
          },
        });
        if (success) notifiedCount++;
      }
    }

    return notifiedCount;
  };

  // TAP to open options
  const handleButtonTap = () => {
    if (!user) { 
      router.push("/login"); 
      return; 
    }
    if (loading) return;

    if (sosActive) {
      setShowActivePopup(true);
      return;
    }

    setShowOptions(true);
  };

  // HOLD to send (after options are shown)
  const handleHoldStart = () => {
    setIsHolding(true);
    setHoldProgress(0);

    const start = Date.now();
    progressInterval.current = setInterval(() => {
      const p = Math.min(((Date.now() - start) / HOLD_DURATION) * 100, 100);
      setHoldProgress(p);
      if (p >= 100) {
        clearInterval(progressInterval.current!);
      }
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
    setShowOptions(false);

    try {
      let lat = 6.5244, lng = 3.3792, address = "Location unavailable";
      
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { 
            enableHighAccuracy: true, 
            timeout: 10000 
          })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        address = await getAddress(lat, lng);
      } catch (locErr) {
        console.warn("Location error:", locErr);
      }

      const { data: userData } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", user.id)
        .single();
      const userName = userData?.full_name || "Someone";

const voiceNoteUrl = null;

      console.log("VOICE NOTE URL ABOUT TO SAVE:", voiceNoteUrl);
      const { data: sosData, error } = await supabase
  .from("sos_alerts")
  .insert({ 
    user_id: user.id, 
    latitude: lat, 
    longitude: lng, 
    address, 
    status: "active",
    tag: selectedTag, // ← ADD THIS
    message: textMessage || null, // ← ADD THIS
  })
  .select()
  .single();

      if (error) throw error;

      setSosActive(true);
      setSosId(sosData.id);

const contactsNotified = await notifyContacts(userName, address, sosData.id, {
  tag: selectedTag,
  message: textMessage || null,
  latitude: lat,
  longitude: lng,
});
      // Notify nearby users
      const { data: nearbyUsers } = await supabase
        .from("users")
        .select("id")
        .neq("id", user.id)
        .eq("status", "active")
        .limit(50);

      const tagInfo = selectedTag ? SOS_TAGS.find(t => t.id === selectedTag) : null;

      let nearbyNotified = 0;
      if (nearbyUsers) {
        for (const nearbyUser of nearbyUsers) {
          const success = await createNotification({
            userId: nearbyUser.id,
            type: "sos_alert",
            title: `SOS Alert: ${tagInfo?.label || "Emergency"}`,
            body: `Someone needs help at ${address}`,
            data: {
            sos_id: sosId,
            tag: selectedTag,
            message: textMessage || null,
            address,
            latitude: lat,
            longitude: lng,
            },
          });
          if (success) nearbyNotified++;
        }
      }

      setNotifyStatus({ contacts: contactsNotified, nearby: nearbyNotified });
      setShowConfirmation(true);
      setTimeout(() => setShowConfirmation(false), 5000);

    } catch (err) {
      console.error("SOS error:", err);
      alert("SOS failed. Please call 112 or 767 directly.");
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
      setShowActivePopup(false);
      setSelectedTag(null);
      setTextMessage("");
      removeRecording();
    } catch (err) {
      console.error("Cancel error:", err);
    } finally {
      setLoading(false);
    }
  };

  const closeOptions = () => {
    setShowOptions(false);
    setSelectedTag(null);
    setTextMessage("");
    removeRecording();
  };

  // ============================================
  // OPTIONS MODAL (Tap to access)
  // ============================================
  if (showOptions) {
    return (
        <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/70" onClick={closeOptions} />
        <div className="relative glass-card w-full max-w-lg rounded-t-3xl rounded-b-none max-h-[85vh] overflow-y-auto pb-8">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <button onClick={closeOptions} className="p-2 hover:bg-white/10 rounded-lg">
              <ArrowLeft className="w-5 h-5 text-dark-300" />
            </button>
            <h3 className="text-lg font-bold text-dark-100">Emergency SOS</h3>
            <div className="w-9" />
          </div>

          <div className="p-4 space-y-6">
            {/* Tag Selection */}
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-3">
                What is the situation? (Optional)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {SOS_TAGS.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => setSelectedTag(selectedTag === tag.id ? null : tag.id)}
                    className={`p-3 rounded-xl text-left transition-all ${
                      selectedTag === tag.id
                        ? "bg-red-600/20 border-2 border-red-500"
                        : "glass-sm hover:bg-white/10 border border-transparent"
                    }`}
                  >
                    <p className="text-sm font-medium text-dark-100">{tag.label}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Text Message */}
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">
                Type a message (Optional)
              </label>
              <textarea
                value={textMessage}
                onChange={(e) => setTextMessage(e.target.value)}
                placeholder="Describe your situation briefly..."
                rows={3}
                className="w-full px-4 py-3 glass-input resize-none text-base"
              />
            </div>

            {/* Hold to Send Button */}
            <div className="pt-4">
              <p className="text-center text-sm text-dark-400 mb-3">
                Press and hold the button below for 3 seconds to send SOS
              </p>
              <button
                onMouseDown={handleHoldStart}
                onMouseUp={handleHoldEnd}
                onMouseLeave={handleHoldEnd}
                onTouchStart={handleHoldStart}
                onTouchEnd={handleHoldEnd}
                className={`relative w-full py-5 rounded-2xl font-bold text-lg text-white transition-all overflow-hidden ${
                  isHolding ? "bg-red-700" : "bg-linear-to-r from-red-600 to-red-700"
                }`}
              >
                {/* Progress bar */}
                {isHolding && (
                  <div 
                    className="absolute inset-0 bg-red-500 transition-all"
                    style={{ width: `${holdProgress}%` }}
                  />
                )}
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <AlertTriangle className="w-6 h-6" />
                  {isHolding 
                    ? `Hold... ${Math.ceil((HOLD_DURATION - holdProgress / 100 * HOLD_DURATION) / 1000)}s` 
                    : "Hold to Send SOS"
                  }
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
        </Portal>
    );
  }

  // ============================================
  // ACTIVE SOS POPUP
  // ============================================
  if (showActivePopup && sosActive) {
    const tagInfo = selectedTag ? SOS_TAGS.find(t => t.id === selectedTag) : null;

    return (
  <Portal>
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
      style={{
        paddingTop: "calc(16px + env(safe-area-inset-top, 0px))",
        paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="absolute inset-0 bg-black/70" onClick={() => setShowActivePopup(false)} />

      <div
        className="relative w-full max-w-md glass-card"
        style={{
          maxHeight: "calc(100dvh - (32px + env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px)))",
          overflowY: "auto",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-red-400 font-semibold">SOS Active</span>
          </div>

          <button onClick={() => setShowActivePopup(false)} className="p-1 hover:bg-white/10 rounded">
            <X className="w-5 h-5 text-dark-400" />
          </button>
        </div>

        {tagInfo && (
          <p className="text-dark-200 mb-3 break-words">
            <span className="font-medium">{tagInfo.label}</span>
          </p>
        )}

        {textMessage && (
          <div className="mb-3 p-3 glass-sm rounded-lg">
            <p className="text-xs text-dark-400 mb-1">Your message:</p>
            <p className="text-dark-200 text-sm break-words whitespace-pre-wrap">{textMessage}</p>
          </div>
        )}

        <div className="flex items-center gap-4 mb-4 text-sm">
          <div className="flex items-center gap-1 text-dark-300">
            <Users className="w-4 h-4 text-primary-400" />
            <span>{notifyStatus.contacts + notifyStatus.nearby} people notified</span>
          </div>
        </div>

        <p className="text-sm text-dark-400 mb-4">
          Your location is being shared for 24 hours. Call emergency services if needed.
        </p>

        <div className="flex gap-2 mb-4">
          <a
            href="tel:112"
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-600 text-white rounded-xl font-medium"
          >
            <Phone className="w-4 h-4" /> Call 112
          </a>
          <a
            href="tel:767"
            className="flex-1 flex items-center justify-center gap-2 py-3 glass-sm text-dark-200 rounded-xl font-medium"
          >
            <Phone className="w-4 h-4" /> Call 767
          </a>
        </div>

        <button
          onClick={cancelSOS}
          disabled={loading}
          className="w-full py-3 glass-sm text-dark-300 hover:text-red-400 rounded-xl font-medium"
        >
          {loading ? "Cancelling..." : "Cancel SOS (I'm safe now)"}
        </button>
      </div>
    </div>
  </Portal>
);
  }

  // ============================================
  // CONFIRMATION POPUP
  // ============================================
  if (showConfirmation) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60" onClick={() => setShowConfirmation(false)} />
        <div className="relative glass-card text-center max-w-sm">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-100 mb-2">SOS Sent</h3>
          <p className="text-dark-400 text-sm">
            {notifyStatus.contacts + notifyStatus.nearby > 0 
              ? `${notifyStatus.contacts + notifyStatus.nearby} Peja users have been notified`
              : "Your location is being shared"
            }
          </p>
          <p className="text-xs text-dark-500 mt-2">
            Please also call 112 or 767 for official emergency response
          </p>
          <button 
            onClick={() => setShowConfirmation(false)}
            className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-xl font-medium"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // ============================================
  // MAIN BUTTON (Pulsing if active)
  // ============================================
  return (
    <button
      onClick={handleButtonTap}
      disabled={loading}
      className={`relative w-16 h-16 rounded-full shadow-lg flex items-center justify-center transition-transform ${
        sosActive 
          ? "bg-linear-to-br from-red-500 to-red-700 animate-pulse" 
          : "bg-linear-to-br from-red-500 to-red-700"
      } ${className}`}
      style={sosActive ? { animation: "sos-pulse 2s infinite" } : {}}
    >
      <style jsx>{`
        @keyframes sos-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          50% { transform: scale(1.05); box-shadow: 0 0 0 15px rgba(239, 68, 68, 0); }
        }
      `}</style>
      {loading ? (
        <Loader2 className="w-7 h-7 text-white animate-spin" />
      ) : (
        <AlertTriangle className="w-7 h-7 text-white" />
      )}
    </button>
  );
}