"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createNotification } from "@/lib/notifications";
import { Portal } from "@/components/ui/Portal";
import { useToast } from "@/context/ToastContext";
import { apiUrl } from "@/lib/api";
import SOSLocation from "@/lib/sosLocation";
import { supabase } from "@/lib/supabase";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import { 
  AlertTriangle, X, Phone, Loader2, CheckCircle, Users, 
  ArrowLeft, Scan, MapPin, Radio, Shield, Send,
  Siren, Car, UserX, Flame, MapPinned, Ban,
} from "lucide-react";

// =====================================================
// SOS TAG DEFINITIONS WITH ICONS & COLORS
// =====================================================
const SOS_TAGS = [
  { id: "accident", label: "Car Accident", icon: Car, color: "#f97316", suggestion: "Check for injuries, call emergency services, and do not move the injured unless there is immediate danger." },
  { id: "robbery", label: "Armed Robbery", icon: Siren, color: "#dc2626", suggestion: "DANGER: Do NOT approach. Contact police immediately at 112 or 767. Stay safe and observe from a distance." },
  { id: "kidnapping", label: "Kidnapping", icon: UserX, color: "#dc2626", suggestion: "EXTREME DANGER: Do NOT approach. Contact police immediately. Do not attempt rescue alone." },
  { id: "fire", label: "Fire", icon: Flame, color: "#f97316", suggestion: "Call fire service. Evacuate the area immediately. Do not enter burning buildings." },
];

type SOSTagId = typeof SOS_TAGS[number]["id"];

interface LoadingStep {
  icon: React.ReactNode;
  text: string;
  status: "pending" | "active" | "done";
}

// =====================================================
// VOICE NOTE COMPONENT
// =====================================================
function VoiceNote({ onRecorded }: { onRecorded: (blob: Blob | null) => void }) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [hasRecording, setHasRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/mp4",
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = URL.createObjectURL(blob);
        onRecorded(blob);
        setHasRecording(true);
      };

      mediaRecorder.start(100);
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);

      // Auto-stop after 60 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          stopRecording();
        }
      }, 60000);
    } catch {
      // Microphone permission denied
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const deleteRecording = () => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setHasRecording(false);
    setDuration(0);
    onRecorded(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(false);
  };

  const togglePlayback = () => {
    if (!audioUrlRef.current) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    const audio = new Audio(audioUrlRef.current);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.play();
    setPlaying(true);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div>
      <label className="block text-xs font-semibold text-dark-400 uppercase tracking-wider mb-2">
        Voice Note (Optional)
      </label>
      {!recording && !hasRecording && (
        <button
          type="button"
          onClick={startRecording}
          className="w-full flex items-center gap-3 p-3 rounded-xl transition-all active:scale-[0.97]"
          style={{
            background: "rgba(20, 12, 36, 0.8)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center">
            <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </div>
          <span className="text-sm text-dark-300">Tap to record voice note</span>
          <span className="text-[10px] text-dark-500 ml-auto">Max 60s</span>
        </button>
      )}

      {recording && (
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
          }}
        >
          <div className="w-9 h-9 rounded-full bg-red-500 flex items-center justify-center animate-pulse">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-400">Recording...</p>
            <p className="text-xs text-dark-400">{formatTime(duration)}</p>
          </div>
          <button
            onClick={stopRecording}
            className="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium active:scale-95 transition-transform"
          >
            Stop
          </button>
        </div>
      )}

      {hasRecording && !recording && (
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{
            background: "rgba(34, 197, 94, 0.06)",
            border: "1px solid rgba(34, 197, 94, 0.15)",
          }}
        >
          <button
            onClick={togglePlayback}
            className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center active:scale-90 transition-transform"
          >
            {playing ? (
              <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4 text-green-400 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>
          <div className="flex-1">
            <p className="text-sm font-medium text-green-400">Voice note recorded</p>
            <p className="text-xs text-dark-400">{formatTime(duration)}</p>
          </div>
          <button
            onClick={deleteRecording}
            className="p-2 rounded-lg hover:bg-white/10 text-dark-400 active:scale-90 transition-transform"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export function SOSButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  
  const [sosActive, setSosActive] = useState(false);
  const [sosId, setSosId] = useState<string | null>(null);
  const sosIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('peja-sos-notify-status');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return { contacts: 0, nearby: 0 };
  });
  const [showOptions, setShowOptions] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [showActivePopup, setShowActivePopup] = useState(false);
  const [selectedTag, setSelectedTag] = useState<SOSTagId | null>(null);
  const [textMessage, setTextMessage] = useState("");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const voiceBlobRef = useRef<Blob | null>(null);
  // =====================================================
  // DISCLOSURE STATE
  // =====================================================
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [disclosureClosing, setDisclosureClosing] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Loading animation states
  const [showLoadingAnimation, setShowLoadingAnimation] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [loadingComplete, setLoadingComplete] = useState(false);
  const [loadingFailed, setLoadingFailed] = useState(false);
  const [showNotifiedCard, setShowNotifiedCard] = useState(false);
  const [modalClosing, setModalClosing] = useState(false);

  const holdTimer = useRef<NodeJS.Timeout | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const toast = useToast();
  useScrollFreeze(showOptions || showActivePopup || showLoadingAnimation || showDisclosure);

  // Register SOS modals with back button system
  useEffect(() => {
    if (showOptions || showActivePopup || showLoadingAnimation || showDisclosure) {
      (window as any).__pejaSosModalOpen = true;
    } else {
      (window as any).__pejaSosModalOpen = false;
    }
    return () => {
      (window as any).__pejaSosModalOpen = false;
    };
  }, [showOptions, showActivePopup, showLoadingAnimation, showDisclosure]);

  // Listen for back button close event
  useEffect(() => {
    const handleBackClose = () => {
      if (showLoadingAnimation && loadingComplete) {
        handleLoadingContinue();
      } else if (showLoadingAnimation) {
        return;
      } else if (showActivePopup) {
        setShowActivePopup(false);
      } else if (showOptions) {
        closeOptions();
      } else if (showDisclosure) {
        closeDisclosure();
      }
    };
    window.addEventListener("peja-close-sos-modal", handleBackClose);
    return () => window.removeEventListener("peja-close-sos-modal", handleBackClose);
  }, [showOptions, showActivePopup, showLoadingAnimation, loadingComplete, showDisclosure]);
  
  const HOLD_DURATION = 3000;

  const loadingSteps: LoadingStep[] = [
    { icon: <Scan className="w-6 h-6" />, text: "Analyzing SOS request...", status: "pending" },
    { icon: <MapPin className="w-6 h-6" />, text: "Pinpointing your location...", status: "pending" },
    { icon: <Radio className="w-6 h-6" />, text: "Scanning for nearby users...", status: "pending" },
    { icon: <Users className="w-6 h-6" />, text: "Capturing available helpers...", status: "pending" },
    { icon: <Shield className="w-6 h-6" />, text: "Notifying emergency contacts...", status: "pending" },
    { icon: <Send className="w-6 h-6" />, text: "Sending help now...", status: "pending" },
  ];

  useEffect(() => {
    if (user) checkActiveSOS();
    return () => cleanup();
  }, [user]);

  useEffect(() => {
    sosIdRef.current = sosId;
  }, [sosId]);

  useEffect(() => {
    if (!sosActive || !sosId) return;
    if (!navigator.geolocation) return;
    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastSent < 5000) return;
        lastSent = now;
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const address = await getAddress(lat, lng);
          
          let bearing = 0;
          if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
            bearing = pos.coords.heading;
          }

          await supabase
            .from("sos_alerts")
            .update({
              latitude: lat,
              longitude: lng,
              bearing,
              address,
              last_updated: new Date().toISOString(),
            })
            .eq("id", sosId);
        } catch (err) {}
      },
      (err) => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [sosActive, sosId]);

  const cleanup = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (progressInterval.current) clearInterval(progressInterval.current);
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
      sosIdRef.current = data.id;
      if (data.tag) setSelectedTag(data.tag);
      if (data.message) setTextMessage(data.message);
      
      const { count: notifiedCount } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("type", "sos_alert")
        .contains("data", { sos_id: data.id });
      
      if (notifiedCount && notifiedCount > 0) {
        const status = { contacts: 0, nearby: notifiedCount };
        setNotifyStatus(status);
        try {
          localStorage.setItem('peja-sos-notify-status', JSON.stringify(status));
        } catch {}
      }
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
  ) => {
    if (!user) return 0;
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

  // =====================================================
  // BUTTON TAP — NOW SHOWS DISCLOSURE FIRST
  // =====================================================
  const handleButtonTap = () => {
    if (user?.status === "suspended") {
      toast.warning("Your account is suspended. SOS is disabled.");
      return;
    }
    if (!user) { 
      router.push("/login"); 
      return; 
    }
    if (loading) return;

    if (sosActive || sosIdRef.current) {
      setSosActive(true);
      setShowActivePopup(true);
      return;
    }

    // Check if user has dismissed the disclosure before
    const dismissed = localStorage.getItem("peja-sos-disclosure-dismissed");
    if (dismissed === "true") {
      setShowOptions(true);
    } else {
      setShowDisclosure(true);
    }
  };

  const handleDisclosureAccept = () => {
    if (dontShowAgain) {
      localStorage.setItem("peja-sos-disclosure-dismissed", "true");
    }
    setShowDisclosure(false);
    setShowOptions(true);
  };

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

  const runLoadingAnimation = async (): Promise<void> => {
    for (let i = 0; i < loadingSteps.length; i++) {
      setCurrentStep(i);
      await new Promise(resolve => setTimeout(resolve, 600));
    }
  };

  const triggerSOS = async () => {
    if (!user) return;
    setLoading(true);
    setIsHolding(false);
    setShowOptions(false);
    
    setShowLoadingAnimation(true);
    setCurrentStep(0);
    setLoadingComplete(false);
    setLoadingFailed(false);
    setShowNotifiedCard(false);
    try {
      const animationPromise = runLoadingAnimation();
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
      } catch (locErr) {}

      const { data: userData } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", user.id)
        .single();

      const userName = userData?.full_name || "Someone";

// Upload voice note if recorded
      let voiceNoteUrl: string | null = null;
      const vBlob = voiceBlobRef.current;
      console.log("[SOS] Voice blob:", vBlob ? `${(vBlob.size / 1024).toFixed(1)}KB, type: ${vBlob.type}` : "none");
      if (vBlob) {
        try {
          const ext = vBlob.type.includes("webm") ? "webm" : "mp4";
          const fileName = `posts/${user.id}/sos-${Date.now()}.${ext}`;
          console.log("[SOS] Uploading voice to:", fileName);
          const { error: uploadErr } = await supabase.storage
            .from("media")
            .upload(fileName, vBlob, { cacheControl: "3600", upsert: false, contentType: "audio/mpeg" });
          if (uploadErr) {
            console.error("[SOS] Voice upload error:", uploadErr);
          } else {
            const { data: pubUrl } = supabase.storage.from("media").getPublicUrl(fileName);
            voiceNoteUrl = pubUrl.publicUrl;
            console.log("[SOS] Voice note URL:", voiceNoteUrl);
          }
        } catch (err) {
          console.error("[SOS] Voice upload exception:", err);
        }
      }

      const { data: sosData, error } = await supabase
        .from("sos_alerts")
        .insert({
          user_id: user.id,
          latitude: lat,
          longitude: lng,
          address: address,
          status: "active",
          tag: selectedTag,
          message: textMessage || null,
          voice_note_url: voiceNoteUrl,
        })
        .select()
        .single();

        console.log("[SOS] Insert result:", { id: sosData?.id, voice_note_url: sosData?.voice_note_url });
      if (error) throw error;

      setSosId(sosData.id);
      sosIdRef.current = sosData.id;
      setSosActive(true);

      supabase.auth.getSession().then(({ data: auth }) => {
        const token = auth.session?.access_token;
        if (!token) return;
        fetch(apiUrl("/api/sos/send-emails"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sosId: sosData.id }),
        }).catch(() => {});
      });

      const contactsNotified = await notifyContacts(userName, address, sosData.id, {
        tag: selectedTag,
        message: textMessage || null,
        latitude: lat,
        longitude: lng,
      });

      const { data: nearby, error: nearbyErr } = await supabase.rpc("users_within_radius", {
        lat,
        lng,
        radius_m: 5000,
        max_results: 200,
      });

      const nearbyIds = (nearby || [])
        .map((r: any) => r.id)
        .filter((id: string) => id && id !== user.id);

      const tagInfo = selectedTag ? SOS_TAGS.find(t => t.id === selectedTag) : null;
      let nearbyNotified = 0;
      for (const uid of nearbyIds) {
        const success = await createNotification({
          userId: uid,
          type: "sos_alert",
          title: `SOS Alert: ${tagInfo?.label || "Emergency"}`,
          body: `Someone needs help at ${address}`,
          data: {
            sos_id: sosData.id,
            tag: selectedTag,
            message: textMessage || null,
            address,
            latitude: lat,
            longitude: lng,
          },
        });
        if (success) nearbyNotified++;
      }

      await animationPromise;

      const newStatus = { contacts: contactsNotified, nearby: nearbyNotified };
      setNotifyStatus(newStatus);
      try {
        localStorage.setItem('peja-sos-notify-status', JSON.stringify(newStatus));
      } catch {}

      // Start native background location tracking
      try {
        const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
        if (isCapacitor) {
          const { data: authData } = await supabase.auth.getSession();
          const token = authData.session?.access_token;
          if (token) {
            await SOSLocation.startTracking({
              sosId: sosData.id,
              supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
              supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
              accessToken: token,
              mode: 'activator',
            });
          }
        }
      } catch (e) {}

      setLoadingComplete(true);
      
      setTimeout(() => {
        setShowNotifiedCard(true);
      }, 500);
    } catch (err) {
      await runLoadingAnimation();
      setLoadingFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadingContinue = () => {
    if (sosIdRef.current) {
      setSosActive(true);
      setSosId(sosIdRef.current);
    }
    setShowLoadingAnimation(false);
    setShowNotifiedCard(false);
    setLoadingComplete(false);
    setCurrentStep(0);
  };

  const cancelSOS = async () => {
    if (!sosId && !sosIdRef.current) return;
    const idToCancel = sosId || sosIdRef.current;
    
    setLoading(true);
    try {
      await supabase
        .from("sos_alerts")
        .update({ status: "cancelled", resolved_at: new Date().toISOString() })
        .eq("id", idToCancel);

      try {
        const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
        if (isCapacitor) {
          await SOSLocation.stopTracking();
        }
      } catch (e) {}

      setSosActive(false);
      setSosId(null);
      sosIdRef.current = null;
      setShowActivePopup(false);
      setSelectedTag(null);
      setTextMessage("");
      setNotifyStatus({ contacts: 0, nearby: 0 });
      try {
        localStorage.removeItem('peja-sos-notify-status');
      } catch {}
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

const closeOptions = () => {
    setModalClosing(true);
    setTimeout(() => {
      setShowOptions(false);
      setSelectedTag(null);
      setTextMessage("");
      setVoiceBlob(null);
      voiceBlobRef.current = null;
      setModalClosing(false);
    }, 250);
  };

  const closeDisclosure = useCallback(() => {
    setDisclosureClosing(true);
    setTimeout(() => {
      setShowDisclosure(false);
      setDisclosureClosing(false);
    }, 200);
  }, []);

  // =====================================================
  // DISCLOSURE MODAL — SHOWN BEFORE SOS OPTIONS
  // =====================================================
  if (showDisclosure) {
    return (
      <Portal>
        <div className="fixed inset-0 z-[25000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => { setDisclosureClosing(true); setTimeout(() => { setShowDisclosure(false); setDisclosureClosing(false); }, 200); }} />
          
          <div
            className={`relative w-full max-w-md rounded-2xl overflow-hidden select-none ${disclosureClosing ? "animate-bounce-out" : "animate-bounce-in"}`}
            style={{
              background: "rgba(12, 8, 24, 0.98)",
              border: "1px solid rgba(239, 68, 68, 0.15)",
              boxShadow: "0 0 80px rgba(239, 68, 68, 0.08), 0 25px 60px rgba(0,0,0,0.6)",
              maxHeight: "calc(100dvh - 64px)",
              overflowY: "auto",
            }}
          >
            {/* Header */}
            <div
              className="px-5 py-4 flex items-center gap-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "2px solid rgba(239, 68, 68, 0.3)",
                }}
              >
                <Shield className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Before You Continue</h3>
                <p className="text-xs text-dark-500">Please read carefully</p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Location Disclosure */}
              <div
                className="p-4 rounded-xl space-y-3"
                style={{
                  background: "rgba(59, 130, 246, 0.06)",
                  border: "1px solid rgba(59, 130, 246, 0.15)",
                }}
              >
                <div className="flex items-center gap-2">
                  <MapPinned className="w-5 h-5 text-blue-400 shrink-0" />
                  <h4 className="font-semibold text-blue-300 text-sm">Location Sharing</h4>
                </div>
                <p className="text-sm text-dark-300 leading-relaxed">
                  When you activate SOS, Peja will <strong className="text-white">continuously track and share your real-time location</strong> with your emergency contacts and nearby users - even when the app is in the background or your screen is off.
                </p>
                <p className="text-sm text-dark-400 leading-relaxed">
                  This allows helpers to find you during an emergency. Location sharing stops only when you cancel the SOS alert.
                </p>
              </div>

              {/* Misuse Warning */}
              <div
                className="p-4 rounded-xl space-y-3"
                style={{
                  background: "rgba(239, 68, 68, 0.06)",
                  border: "1px solid rgba(239, 68, 68, 0.15)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Ban className="w-5 h-5 text-red-400 shrink-0" />
                  <h4 className="font-semibold text-red-300 text-sm">Misuse Warning</h4>
                </div>
                <p className="text-sm text-dark-300 leading-relaxed">
                  The SOS feature is <strong className="text-white">strictly for genuine emergencies</strong> where you or someone nearby is in serious personal danger.
                </p>
                <p className="text-sm text-red-400/90 leading-relaxed font-medium">
                  Misuse of the SOS feature - including false alerts, pranks, or non-emergency use - will result in a permanent ban from Peja with no appeal.
                </p>
              </div>

              {/* Don't show again */}
              <label
                className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors hover:bg-white/[0.02]"
                style={{
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div
                  className="w-5 h-5 rounded flex items-center justify-center shrink-0 transition-all"
                  style={{
                    background: dontShowAgain
                      ? "rgba(139, 92, 246, 0.8)"
                      : "rgba(255,255,255,0.06)",
                    border: dontShowAgain
                      ? "1px solid rgba(139, 92, 246, 0.9)"
                      : "1px solid rgba(255,255,255,0.15)",
                  }}
                >
                  {dontShowAgain && (
                    <CheckCircle className="w-3.5 h-3.5 text-white" />
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)}
                  className="sr-only"
                />
                <span className="text-sm text-dark-300">Don&apos;t show this again</span>
              </label>

              {/* Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={closeDisclosure}
                  className="flex-1 py-3 rounded-xl font-medium text-dark-400 transition-all hover:bg-white/5 active:scale-[0.98]"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDisclosureAccept}
                  className="flex-1 py-3 rounded-xl font-bold text-white transition-all active:scale-[0.98]"
                  style={{
                    background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                    boxShadow: "0 4px 20px rgba(239,68,68,0.3)",
                  }}
                >
                  I Understand
                </button>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    );
  }

  // =====================================================
  // LOADING ANIMATION MODAL
  // =====================================================
  if (showLoadingAnimation) {
    return (
      <Portal>
        <div className="fixed inset-0 z-[25000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80" />
          
          <div className="relative sos-loading-card w-full max-w-sm p-6">
            {!loadingComplete && !loadingFailed && (
              <>
                <div className="flex justify-center mb-6">
                  <div className="sos-icon-container">
                    <div className="sos-icon-glow" />
                    <div className="sos-icon-inner">
                      {loadingSteps[currentStep]?.icon}
                    </div>
                  </div>
                </div>
                
                <p className="text-center text-lg font-medium text-white mb-6 select-none">
                  {loadingSteps[currentStep]?.text}
                </p>
                
                <div className="flex justify-center gap-2">
                  {loadingSteps.map((_, index) => (
                    <div
                      key={index}
                      className={`sos-progress-dot ${
                        index < currentStep ? "done" : 
                        index === currentStep ? "active" : "pending"
                      }`}
                    />
                  ))}
                </div>
              </>
            )}

            {loadingComplete && showNotifiedCard && (
              <div className="sos-notified-card text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                    <CheckCircle className="w-10 h-10 text-green-400" />
                  </div>
                </div>
                
                <h3 className="text-xl font-bold text-white mb-2 select-none">SOS Sent Successfully</h3>
                
                <div className="flex items-center justify-center gap-2 mb-4">
                  <Users className="w-5 h-5 text-primary-400" />
                  <span className="text-2xl font-bold text-primary-400">
                    {notifyStatus.contacts + notifyStatus.nearby}
                  </span>
                  <span className="text-dark-300 select-none">Users Notified</span>
                </div>
                
                <p className="text-sm text-dark-400 mb-6 select-none">
                  Help is being coordinated. Stay calm and stay safe.
                </p>
                
                <button
                  onClick={handleLoadingContinue}
                  className="w-full py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors select-none"
                >
                  Continue
                </button>
              </div>
            )}

            {loadingFailed && (
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                    <X className="w-10 h-10 text-red-400" />
                  </div>
                </div>
                
                <h3 className="text-xl font-bold text-white mb-2 select-none">SOS Failed</h3>
                <p className="text-sm text-dark-400 mb-6 select-none">
                  Unable to send SOS. Please call emergency services directly.
                </p>
                
                <div className="flex gap-2 mb-4">
                  <a href="tel:112" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium text-center select-none">
                    Call 112
                  </a>
                  <a href="tel:767" className="flex-1 py-3 bg-red-500 text-white rounded-xl font-medium text-center select-none">
                    Call 767
                  </a>
                </div>
                
                <button
                  onClick={() => {
                    setShowLoadingAnimation(false);
                    setLoadingFailed(false);
                  }}
                  className="w-full py-3 glass-sm text-dark-300 rounded-xl font-medium select-none"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </Portal>
    );
  }

  // =====================================================
  // OPTIONS MODAL
  // =====================================================
  if (showOptions) {
    return (
      <Portal>
        <div className="fixed inset-0 z-[25000] flex items-end sm:items-center justify-center cap-status-pad">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={closeOptions} />
          
           <div
            className={`relative w-full max-w-lg rounded-t-3xl sm:rounded-3xl overflow-y-auto select-none ${modalClosing ? "animate-bounce-out" : "animate-bounce-in"}`}
            style={{
              maxHeight: "calc(100dvh - var(--cap-status-bar-height, 0px) - env(safe-area-inset-bottom, 0px) - 32px)",
              background: "rgba(12, 8, 24, 0.98)",
              border: "1px solid rgba(239, 68, 68, 0.15)",
              boxShadow: "0 0 80px rgba(239, 68, 68, 0.08), 0 -20px 60px rgba(0,0,0,0.5)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <button onClick={closeOptions} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                <ArrowLeft className="w-5 h-5 text-dark-300" />
              </button>
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{
                    background: "rgba(239, 68, 68, 0.15)",
                    boxShadow: "0 0 20px rgba(239, 68, 68, 0.2)",
                  }}
                >
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-white">Emergency SOS</h3>
              </div>
              <div className="w-9" />
            </div>

            <div className="p-5 space-y-5">
              {/* Situation Tags */}
              <div>
                <label className="block text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">
                  What is the situation?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {SOS_TAGS.map((tag) => {
                    const isSelected = selectedTag === tag.id;
                    const TagIcon = tag.icon;
                    return (
                      <button
                        key={tag.id}
                        onClick={() => setSelectedTag(isSelected ? null : tag.id)}
                        className="relative p-3 rounded-xl text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.92]"
                        style={{
                          background: isSelected
                            ? `${tag.color}15`
                            : "rgba(255, 255, 255, 0.02)",
                          border: `1px solid ${isSelected ? `${tag.color}50` : "rgba(255,255,255,0.06)"}`,
                          boxShadow: isSelected ? `0 0 20px ${tag.color}15` : "none",
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                            style={{
                              background: isSelected
                                ? `${tag.color}20`
                                : "rgba(255,255,255,0.04)",
                            }}
                          >
                            <TagIcon
                              className="w-4 h-4"
                              style={{ color: isSelected ? tag.color : "#94a3b8" }}
                            />
                          </div>
                          <span
                            className="text-sm font-medium transition-colors leading-tight"
                            style={{ color: isSelected ? tag.color : "#e2e8f0" }}
                          >
                            {tag.label}
                          </span>
                        </div>
                        {isSelected && (
                          <div
                            className="absolute top-2 right-2 w-2 h-2 rounded-full"
                            style={{ background: tag.color, boxShadow: `0 0 8px ${tag.color}` }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-semibold text-dark-400 uppercase tracking-wider mb-2">
                  Message (Optional)
                </label>
                <textarea
                  value={textMessage}
                  onChange={(e) => setTextMessage(e.target.value)}
                  placeholder="Describe your situation briefly..."
                  rows={3}
                  className="w-full px-4 py-3 glass-input resize-none text-base"
                  style={{ background: "rgba(20, 12, 36, 0.8)" }}
                />
              </div>

              {/* Voice Note */}
              <VoiceNote onRecorded={(blob) => { setVoiceBlob(blob); voiceBlobRef.current = blob; }} />

              {/* Hold Button */}
              <div className="pt-2 pb-2">
                <p className="text-center text-xs text-dark-500 mb-3 select-none">
                  Press and hold for 3 seconds to send SOS
                </p>
                <button
                  onMouseDown={handleHoldStart}
                  onMouseUp={handleHoldEnd}
                  onMouseLeave={handleHoldEnd}
                  onTouchStart={handleHoldStart}
                  onTouchEnd={handleHoldEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  className="relative w-full py-5 rounded-2xl font-bold text-lg text-white transition-all overflow-hidden select-none active:scale-[0.96]"
                  style={{
                    background: isHolding
                      ? "#991b1b"
                      : "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                    boxShadow: isHolding
                      ? "0 0 40px rgba(239,68,68,0.4), 0 0 80px rgba(239,68,68,0.15)"
                      : "0 4px 20px rgba(239,68,68,0.3), 0 0 40px rgba(239,68,68,0.08)",
                    WebkitUserSelect: "none",
                    userSelect: "none",
                    WebkitTouchCallout: "none",
                  } as React.CSSProperties}
                >
                  {isHolding && (
                    <div 
                      className="absolute inset-y-0 left-0 transition-all duration-100"
                      style={{
                        width: `${holdProgress}%`,
                        background: "linear-gradient(90deg, rgba(239,68,68,0.8), rgba(239,68,68,0.6))",
                        boxShadow: "0 0 30px rgba(239,68,68,0.5)",
                      }}
                    />
                  )}
                  <span className="relative z-10 flex items-center justify-center gap-2 select-none">
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

  // =====================================================
  // ACTIVE SOS POPUP
  // =====================================================
  if (showActivePopup && sosActive) {
    const tagInfo = selectedTag ? SOS_TAGS.find(t => t.id === selectedTag) : null;
    return (
      <Portal>
        <div
          className="fixed inset-0 z-[25000] flex items-center justify-center px-4"
          style={{
            paddingTop: "calc(16px + var(--cap-status-bar-height, 0px) + env(safe-area-inset-top, 0px))",
            paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowActivePopup(false)} />
          <div
            className="relative w-full max-w-md rounded-2xl overflow-hidden select-none"
            style={{
              background: "rgba(12, 8, 24, 0.98)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              boxShadow: "0 0 60px rgba(239, 68, 68, 0.1), 0 25px 60px rgba(0,0,0,0.6)",
              maxHeight: "calc(100dvh - (32px + env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px)))",
              overflowY: "auto",
            }}
          >
            {/* Active Header with glow strip */}
            <div
              className="relative px-5 py-4"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-[2px]"
                style={{
                  background: "linear-gradient(90deg, transparent, #ef4444, transparent)",
                  boxShadow: "0 0 20px rgba(239,68,68,0.5)",
                }}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{
                      background: "rgba(239, 68, 68, 0.15)",
                      border: "2px solid rgba(239, 68, 68, 0.3)",
                      boxShadow: "0 0 20px rgba(239, 68, 68, 0.2)",
                    }}
                  >
                    <Siren className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-red-400 font-bold text-sm uppercase tracking-wider">SOS Active</span>
                    </div>
                    <p className="text-xs text-dark-500">Your location is being shared</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowActivePopup(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5 text-dark-400" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {tagInfo && (
                <div
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{
                    background: `${tagInfo.color}10`,
                    border: `1px solid ${tagInfo.color}25`,
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${tagInfo.color}20` }}
                  >
                    <tagInfo.icon className="w-5 h-5" style={{ color: tagInfo.color }} />
                  </div>
                  <span className="font-semibold text-dark-100">{tagInfo.label}</span>
                </div>
              )}

              {textMessage && (
                <div
                  className="p-3 rounded-xl"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <p className="text-xs text-dark-500 mb-1 uppercase tracking-wider font-semibold">Your message</p>
                  <p className="text-dark-200 text-sm break-words whitespace-pre-wrap">{textMessage}</p>
                </div>
              )}

              <div
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{
                  background: "rgba(139, 92, 246, 0.08)",
                  border: "1px solid rgba(139, 92, 246, 0.15)",
                }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "rgba(139, 92, 246, 0.15)" }}
                >
                  <Users className="w-5 h-5 text-primary-400" />
                </div>
                <div>
                  <span className="text-lg font-bold text-primary-400">
                    {notifyStatus.contacts + notifyStatus.nearby}
                  </span>
                  <span className="text-dark-400 text-sm ml-1.5">people notified</span>
                </div>
              </div>

              <div className="flex gap-2">
                <a
                  href="tel:112"
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-medium transition-all active:scale-95"
                  style={{
                    background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                    boxShadow: "0 4px 15px rgba(239,68,68,0.25)",
                    color: "white",
                  }}
                >
                  <Phone className="w-4 h-4" /> Call 112
                </a>
                <a
                  href="tel:767"
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-medium transition-all active:scale-95"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#e2e8f0",
                  }}
                >
                  <Phone className="w-4 h-4" /> Call 767
                </a>
              </div>

              <button
                onClick={cancelSOS}
                disabled={loading}
                className="w-full py-3 rounded-xl font-medium transition-all hover:bg-white/5 active:scale-[0.98]"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "#94a3b8",
                }}
              >
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Cancelling...
                  </div>
                ) : (
                  "Cancel SOS (I'm safe now)"
                )}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    );
  }

  // =====================================================
  // MAIN BUTTON
  // =====================================================
 return (
    <button
      onClick={handleButtonTap}
      disabled={loading}
     className={`relative w-full h-full rounded-full shadow-lg flex items-center justify-center bg-gradient-to-br from-red-500 to-red-700 select-none ${
        sosActive ? "sos-button-active" : "active:scale-[0.95] transition-transform"
      } ${className}`}
      style={{
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      } as React.CSSProperties}
    >
      {loading ? (
        <Loader2 className="w-7 h-7 text-white animate-spin" />
      ) : (
        <AlertTriangle className="w-7 h-7 text-white" />
      )}
    </button>
  );
}