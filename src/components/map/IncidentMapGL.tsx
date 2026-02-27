"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import MapGL, { Marker, NavigationControl, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { Post, CATEGORIES, SOSAlert, SOS_TAGS } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { useAuth } from "@/context/AuthContext";
import { CheckCircle } from "lucide-react";
import SOSLocation from "@/lib/sosLocation";
interface IncidentMapGLProps {
  posts: Post[];
  userLocation: { lat: number; lng: number } | null;
  onPostClick: (postId: string) => void;
  sosAlerts?: SOSAlert[];
  onSOSClick?: (id: string) => void;
  centerOnUser?: boolean;
  centerOnCoords?: { lat: number; lng: number } | null;
  openSOSId?: string | null;
  compassEnabled?: boolean;
  myUserId?: string | null;
}
interface Helper {
  id: string;
  name: string;
  avatar_url?: string;
  lat: number;
  lng: number;
  eta: number;
  sosId?: string;
}
interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}
// =====================================================================
// MILESTONE-BASED HELPER TRACKING CONSTANTS
// =====================================================================
const HELPER_MILESTONES = [30, 20, 10, 5, 2, 1] as const;
const ARRIVAL_DISTANCE_KM = 0.3; // 300 meters = "arrived"
const HELPER_TRACKING_TIMEOUT_MS = 5 * 60 * 60 * 1000; // 5 hours
const HELPER_GPS_THROTTLE_MS = 30_000; // 30 seconds between GPS checks
const HELPER_MIN_MOVEMENT_KM = 0.1; // 100 meters minimum movement
// localStorage keys
const HELPERS_STORAGE_KEY = "peja-active-helpers";
const HELPED_SOS_KEY = "peja-helped-sos";
const MILESTONE_STORAGE_KEY = "peja-helper-milestones";
// =====================================================================
// UTILITY FUNCTIONS
// =====================================================================
function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function calculateETA(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const distance = getDistanceKm(fromLat, fromLng, toLat, toLng);
  return Math.max(1, Math.round((distance / 30) * 60));
}
function getCategoryColor(categoryId: string): string {
  const category = CATEGORIES.find(c => c.id === categoryId);
  switch (category?.color) {
    case "danger": return "#ef4444";
    case "warning": return "#f97316";
    case "awareness": return "#eab308";
    default: return "#3b82f6";
  }
}
// =====================================================================
// MILESTONE PERSISTENCE (localStorage)
// =====================================================================
function readFiredMilestones(sosId: string, helperId: string): Set<string> {
  try {
    const raw = localStorage.getItem(MILESTONE_STORAGE_KEY);
    if (!raw) return new Set();
    const all = JSON.parse(raw);
    const key = `${sosId}:${helperId}`;
    return new Set(all[key] || []);
  } catch {
    return new Set();
  }
}
function saveFiredMilestone(sosId: string, helperId: string, milestone: string) {
  try {
    const raw = localStorage.getItem(MILESTONE_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    const key = `${sosId}:${helperId}`;
    if (!all[key]) all[key] = [];
    if (!all[key].includes(milestone)) all[key].push(milestone);
    localStorage.setItem(MILESTONE_STORAGE_KEY, JSON.stringify(all));
  } catch {}
}
function clearFiredMilestones(sosId: string, helperId: string) {
  try {
    const raw = localStorage.getItem(MILESTONE_STORAGE_KEY);
    if (!raw) return;
    const all = JSON.parse(raw);
    const key = `${sosId}:${helperId}`;
    delete all[key];
    localStorage.setItem(MILESTONE_STORAGE_KEY, JSON.stringify(all));
  } catch {}
}
// =====================================================================
// COMPONENT
// =====================================================================
export default function IncidentMapGL({
  posts,
  userLocation,
  onPostClick,
  sosAlerts = [],
  onSOSClick,
  centerOnUser = false,
  centerOnCoords = null,
  openSOSId = null,
  compassEnabled = false,
  myUserId = null,
}: IncidentMapGLProps) {
  const { user } = useAuth();
  const mapRef = useRef<MapRef>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);
  const autoOpenedRef = useRef(false);
  const sosAlertsLoadedRef = useRef(false);
  // Helper tracking refs — using Record instead of Map to avoid name collision
  const helperWatchIdsRef = useRef<Record<string, number>>({});
  const helperTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const restartedRef = useRef(false);
  const helpersRecoveredRef = useRef(false);
  // Compass smoothing refs
  const targetBearing = useRef(0);
  const currentBearing = useRef(0);
  const animationFrameId = useRef<number | null>(null);
  const isUserInteracting = useRef(false);
  const interactionTimeout = useRef<NodeJS.Timeout | null>(null);
  const [viewState, setViewState] = useState<ViewState>({
    longitude: userLocation?.lng || 3.3792,
    latitude: userLocation?.lat || 6.5244,
    zoom: 14,
    bearing: 0,
    pitch: 0,
  });
  const [bearing, setBearing] = useState(0);
  const [selectedSOS, setSelectedSOS] = useState<SOSAlert | null>(null);
  const [sendingHelp, setSendingHelp] = useState(false);
  const [liveSOSAlerts, setLiveSOSAlerts] = useState<SOSAlert[]>(sosAlerts);
  const [toast, setToast] = useState<string | null>(null);
  // Helpers state — initialized from localStorage
  const [helpers, setHelpers] = useState<Helper[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(HELPERS_STORAGE_KEY);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });
  // Track which SOSes this user has offered to help
  const [helpedSOSIds, setHelpedSOSIds] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(HELPED_SOS_KEY);
        if (saved) return new Set(JSON.parse(saved));
      } catch {}
    }
    return new Set();
  });
  // =====================================================================
  // PERSIST HELPERS TO localStorage
  // =====================================================================
  useEffect(() => {
    try {
      if (helpers.length > 0) {
        localStorage.setItem(HELPERS_STORAGE_KEY, JSON.stringify(helpers));
      } else {
        localStorage.removeItem(HELPERS_STORAGE_KEY);
      }
    } catch {}
  }, [helpers]);
  // =====================================================================
  // RECOVER HELPERS FROM SUPABASE ON MOUNT (for SOS activator)
  // When the SOS activator refreshes, localStorage might have stale data.
  // We query Supabase for recent helper notifications to rebuild the list.
  // =====================================================================
  useEffect(() => {
    if (!myUserId) return;
    if (helpersRecoveredRef.current) return;
    helpersRecoveredRef.current = true;
    const recoverHelpers = async () => {
      // Find all active SOS alerts owned by this user
      const { data: myActiveSOSes } = await supabase
        .from("sos_alerts")
        .select("id")
        .eq("user_id", myUserId)
        .eq("status", "active");
      if (!myActiveSOSes || myActiveSOSes.length === 0) return;
      const sosIds = myActiveSOSes.map(s => s.id);
      // Query notifications for helper data sent to this user in the last 5 hours
      const fiveHoursAgo = new Date(Date.now() - HELPER_TRACKING_TIMEOUT_MS).toISOString();
      const { data: helperNotifications } = await supabase
        .from("notifications")
        .select("data, created_at")
        .eq("user_id", myUserId)
        .eq("type", "sos_alert")
        .gte("created_at", fiveHoursAgo)
        .order("created_at", { ascending: false });
      if (!helperNotifications || helperNotifications.length === 0) return;
      // Build helpers map — latest notification per helper wins
      const helperMap: Record<string, Helper> = {};
      for (const notif of helperNotifications) {
        const d = notif.data as any;
        if (!d?.helper_id || !d?.sos_id) continue;
        if (!sosIds.includes(d.sos_id)) continue;
        // Only keep the latest entry per helper
        if (!helperMap[d.helper_id]) {
          helperMap[d.helper_id] = {
            id: d.helper_id,
            name: d.helper_name || "Someone",
            avatar_url: d.helper_avatar || undefined,
            lat: d.helper_lat,
            lng: d.helper_lng,
            eta: d.eta_minutes || 0,
            sosId: d.sos_id,
          };
        }
      }
      const recovered = Object.values(helperMap);
      if (recovered.length > 0) {
        setHelpers(prev => {
          // Merge: keep existing helpers, add/update from Supabase
          const merged = [...prev];
          for (const rh of recovered) {
            const existingIdx = merged.findIndex(h => h.id === rh.id);
            if (existingIdx !== -1) {
              // Update with latest data from Supabase
              merged[existingIdx] = { ...merged[existingIdx], ...rh };
            } else {
              merged.push(rh);
            }
          }
          return merged;
        });
      }
    };
    recoverHelpers();
  }, [myUserId]);
  // =====================================================================
  // CLEAN UP HELPERS FOR INACTIVE SOS ALERTS
  // =====================================================================
  useEffect(() => {
    if (sosAlerts.length > 0) {
      sosAlertsLoadedRef.current = true;
    }
    if (!sosAlertsLoadedRef.current) return;
    if (liveSOSAlerts.length === 0) {
      setHelpers([]);
      try { localStorage.removeItem(HELPERS_STORAGE_KEY); } catch {}
      return;
    }
    const activeSOSIds = new Set(liveSOSAlerts.map(s => s.id));
    setHelpers(prev => {
      const filtered = prev.filter(h => h.sosId && activeSOSIds.has(h.sosId));
      if (filtered.length !== prev.length) {
        try {
          if (filtered.length > 0) {
            localStorage.setItem(HELPERS_STORAGE_KEY, JSON.stringify(filtered));
          } else {
            localStorage.removeItem(HELPERS_STORAGE_KEY);
          }
        } catch {}
      }
      return filtered;
    });
  }, [liveSOSAlerts, sosAlerts]);
  // Update SOS alerts from props
  useEffect(() => {
    setLiveSOSAlerts(sosAlerts);
  }, [sosAlerts]);
  // Auto-open SOS from URL
  useEffect(() => {
    if (!openSOSId || autoOpenedRef.current) return;
    const match = liveSOSAlerts.find(s => s.id === openSOSId);
    if (match) {
      setSelectedSOS(match);
      autoOpenedRef.current = true;
    }
  }, [openSOSId, liveSOSAlerts]);
  // Lock body scroll when modal is open
  useEffect(() => {
    if (selectedSOS) {
      const scrollY = window.scrollY;
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.top = `-${scrollY}px`;
      setTimeout(() => {
        if (modalContentRef.current) {
          modalContentRef.current.scrollTop = 0;
        }
      }, 50);
    } else {
      const scrollY = document.body.style.top;
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.body.style.top = "";
      window.scrollTo(0, parseInt(scrollY || "0") * -1);
    }
    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.body.style.top = "";
    };
  }, [selectedSOS]);

    // Register SOS detail modal with back button system
  useEffect(() => {
    if (selectedSOS) {
      (window as any).__pejaSosDetailOpen = true;
    } else {
      (window as any).__pejaSosDetailOpen = false;
    }
    return () => {
      (window as any).__pejaSosDetailOpen = false;
    };
  }, [selectedSOS]);

  // Listen for back button close event
  useEffect(() => {
    const handleBackClose = () => {
      setSelectedSOS(null);
    };
    window.addEventListener("peja-close-sos-detail", handleBackClose);
    return () => window.removeEventListener("peja-close-sos-detail", handleBackClose);
  }, []);


  // Center on user when requested
  useEffect(() => {
    if (centerOnUser && mapRef.current && userLocation) {
      mapRef.current.flyTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: 16,
        duration: 1000,
      });
    }
  }, [centerOnUser, userLocation]);
  // Center on coords when requested
  useEffect(() => {
    if (centerOnCoords && mapRef.current) {
      mapRef.current.flyTo({
        center: [centerOnCoords.lng, centerOnCoords.lat],
        zoom: 16,
        duration: 1000,
      });
    }
  }, [centerOnCoords]);
  // Smooth animation loop for compass
  useEffect(() => {
    if (!compassEnabled) {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      return;
    }
    const animate = () => {
      if (isUserInteracting.current) {
        animationFrameId.current = requestAnimationFrame(animate);
        return;
      }
      let diff = targetBearing.current - currentBearing.current;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      if (Math.abs(diff) > 0.1) {
        currentBearing.current += diff * 0.08;
        currentBearing.current = ((currentBearing.current % 360) + 360) % 360;
        setViewState(prev => ({ ...prev, bearing: currentBearing.current }));
      }
      animationFrameId.current = requestAnimationFrame(animate);
    };
    animationFrameId.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [compassEnabled]);
  // Compass sensor listener
  useEffect(() => {
    if (!compassEnabled) {
      targetBearing.current = 0;
      currentBearing.current = 0;
      setBearing(0);
      if (mapRef.current) mapRef.current.easeTo({ bearing: 0, duration: 500 });
      return;
    }
    const handleOrientation = (event: DeviceOrientationEvent) => {
      let newBearing = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((event as any).webkitCompassHeading !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newBearing = (event as any).webkitCompassHeading;
      } else if (event.alpha !== null) {
        newBearing = 360 - event.alpha;
      }
      const normalized = ((newBearing % 360) + 360) % 360;
      targetBearing.current = normalized;
      setBearing(normalized);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (DeviceOrientationEvent as any).requestPermission === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (DeviceOrientationEvent as any).requestPermission()
        .then((response: string) => {
          if (response === "granted") {
            window.addEventListener("deviceorientation", handleOrientation, true);
          }
        })
        .catch(() => {});
    } else {
      window.addEventListener("deviceorientation", handleOrientation, true);
    }
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, [compassEnabled]);
  // Real-time SOS updates
  useEffect(() => {
    const channel = supabase
      .channel("sos-map-realtime-gl")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sos_alerts" },
        (payload) => {
          const updatedSOS = payload.new as SOSAlert;
          setLiveSOSAlerts(prev =>
            prev.map(sos => sos.id === updatedSOS.id ? { ...sos, ...updatedSOS } : sos)
          );
          if (selectedSOS?.id === updatedSOS.id) {
            setSelectedSOS(prev => prev ? { ...prev, ...updatedSOS } : null);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedSOS?.id]);
  // Real-time user location tracking (purple dot moves in real-time)
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        window.dispatchEvent(new CustomEvent("peja-user-location-update", {
          detail: { lat: position.coords.latitude, lng: position.coords.longitude }
        }));
      },
      (error) =>    return () => navigator.geolocation.clearWatch(watchId);
  }, []);
  // Real-time SOS location updates (SOS markers move in real-time)
  useEffect(() => {
    const channel = supabase
      .channel("sos-location-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sos_alerts" },
        (payload) => {
          const updated = payload.new as SOSAlert;
          setLiveSOSAlerts(prev =>
            prev.map(sos =>
              sos.id === updated.id
                ? { ...sos, latitude: updated.latitude, longitude: updated.longitude, bearing: updated.bearing }
                : sos
            )
          );
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);
  // =====================================================================
  // LISTEN FOR HELPER NOTIFICATIONS (SOS activator receives these)
  // This handles BOTH new helpers AND location updates from existing helpers
  // =====================================================================
  useEffect(() => {
    if (!myUserId) return;
    const channel = supabase
      .channel("sos-helpers-realtime-gl")
      .on(
        "postgres_changes",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${myUserId}` } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (payload: any) => {
          const notification = payload.new;
          if (notification?.type === "sos_alert" && notification?.data?.helper_id) {
            const helperData = notification.data;
            const helperId = helperData.helper_id;
            const sosId = helperData.sos_id;
            setHelpers(prevHelpers => {
              const existingIndex = prevHelpers.findIndex(h => h.id === helperId);
              if (existingIndex !== -1) {
                // Update existing helper's position and ETA
                const updated = [...prevHelpers];
                updated[existingIndex] = {
                  ...updated[existingIndex],
                  lat: helperData.helper_lat,
                  lng: helperData.helper_lng,
                  eta: helperData.eta_minutes,
                };
                return updated;
              }
              // Add new helper — accumulate, don't replace
              return [
                ...prevHelpers,
                {
                  id: helperId,
                  name: helperData.helper_name || "Someone",
                  avatar_url: helperData.helper_avatar,
                  lat: helperData.helper_lat,
                  lng: helperData.helper_lng,
                  eta: helperData.eta_minutes,
                  sosId: sosId,
                },
              ];
            });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [myUserId]);
  // =====================================================================
  // MILESTONE-BASED HELPER LOCATION TRACKING
  // Called on the HELPER's device to track their movement toward SOS
  // =====================================================================
  const startHelperLocationTracking = useCallback((
    sosOwnerId: string,
    sosId: string,
    helperName: string,
    helperAvatar?: string,
  ) => {
    if (!user) return;
    if (!navigator.geolocation) return;
    const helperId = user.id;
    // Clean up any existing watcher for this SOS
    const existingWatchId = helperWatchIdsRef.current[sosId];
    if (existingWatchId !== undefined) {
      navigator.geolocation.clearWatch(existingWatchId);
      delete helperWatchIdsRef.current[sosId];
    }
    const existingTimeout = helperTimeoutsRef.current[sosId];
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      delete helperTimeoutsRef.current[sosId];
    }
    // Load already-fired milestones from localStorage
    const firedMilestones = readFiredMilestones(sosId, helperId);
    let lastUpdateTime = 0;
    let lastLat = 0;
    let lastLng = 0;
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        // Throttle: minimum 30 seconds between checks
        if (now - lastUpdateTime < HELPER_GPS_THROTTLE_MS) return;
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        // Check if user has actually moved (at least 100 meters)
        if (lastLat && lastLng) {
          const distanceMoved = getDistanceKm(lastLat, lastLng, lat, lng);
          if (distanceMoved < HELPER_MIN_MOVEMENT_KM) return;
        }
        lastLat = lat;
        lastLng = lng;
        lastUpdateTime = now;
        // Check if SOS is still active
        const { data: sosData } = await supabase
          .from("sos_alerts")
          .select("latitude, longitude, status")
          .eq("id", sosId)
          .single();
        if (!sosData || sosData.status !== "active") {
          // SOS resolved/cancelled — stop tracking
          navigator.geolocation.clearWatch(watchId);
          delete helperWatchIdsRef.current[sosId];
          const t = helperTimeoutsRef.current[sosId];
          if (t) { clearTimeout(t); delete helperTimeoutsRef.current[sosId]; }
          clearFiredMilestones(sosId, helperId);
          return;
        }
        const distanceKm = getDistanceKm(lat, lng, sosData.latitude, sosData.longitude);
        const eta = calculateETA(lat, lng, sosData.latitude, sosData.longitude);
        // ===== MILESTONE CHECK =====
        let milestoneToFire: string | null = null;
        let notificationTitle = "";
        let notificationBody = "";
        // Check "arrived" first (distance-based, not ETA-based)
        if (distanceKm <= ARRIVAL_DISTANCE_KM && !firedMilestones.has("arrived")) {
          milestoneToFire = "arrived";
          notificationTitle = "Helper has arrived!";
          notificationBody = `${helperName} has arrived at your location`;
        } else {
          // Check ETA milestones (highest first)
          for (const milestone of HELPER_MILESTONES) {
            const key = `${milestone}min`;
            if (eta <= milestone && !firedMilestones.has(key)) {
              milestoneToFire = key;
              if (milestone <= 1) {
                notificationTitle = "Helper is arriving!";
                notificationBody = `${helperName} is less than a minute away`;
              } else if (milestone <= 2) {
                notificationTitle = "Helper is very close!";
                notificationBody = `${helperName} is about ${milestone} minutes away`;
              } else if (milestone <= 5) {
                notificationTitle = "Helper is almost there!";
                notificationBody = `${helperName} is about ${milestone} minutes away`;
              } else {
                notificationTitle = "Helper getting closer!";
                notificationBody = `${helperName} is about ${milestone} minutes away`;
              }
              break; // Fire only the most relevant milestone
            }
          }
        }
        if (milestoneToFire) {
          // Mark milestone as fired (persisted to localStorage)
          firedMilestones.add(milestoneToFire);
          saveFiredMilestone(sosId, helperId, milestoneToFire);
          await createNotification({
            userId: sosOwnerId,
            type: "sos_alert",
            title: notificationTitle,
            body: notificationBody,
            data: {
              sos_id: sosId,
              helper_id: helperId,
              helper_name: helperName,
              helper_avatar: helperAvatar || null,
              helper_lat: lat,
              helper_lng: lng,
              eta_minutes: eta,
              milestone: milestoneToFire,
              is_location_update: true,
            },
          });
        }
        // If arrived, stop tracking
        if (firedMilestones.has("arrived")) {
          navigator.geolocation.clearWatch(watchId);
          delete helperWatchIdsRef.current[sosId];
          const t = helperTimeoutsRef.current[sosId];
          if (t) { clearTimeout(t); delete helperTimeoutsRef.current[sosId]; }
          return;
        }
      },
      (error) => {
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    // Store watchId for cleanup
    helperWatchIdsRef.current[sosId] = watchId;
    // Stop tracking after 5 hours maximum
    const timeout = setTimeout(() => {
      navigator.geolocation.clearWatch(watchId);
      delete helperWatchIdsRef.current[sosId];
      delete helperTimeoutsRef.current[sosId];
    }, HELPER_TRACKING_TIMEOUT_MS);
    helperTimeoutsRef.current[sosId] = timeout;
  }, [user]);
  // =====================================================================
  // HANDLE "I CAN HELP" BUTTON
  // =====================================================================
  const handleICanHelp = async (sos: SOSAlert) => {
    if (!user || !userLocation) {
      setToast("Please enable location to help");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    // Prevent double-clicking
    if (helpedSOSIds.has(sos.id)) {
      setToast("You've already offered to help!");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setSendingHelp(true);
    try {
      const eta = calculateETA(userLocation.lat, userLocation.lng, sos.latitude, sos.longitude);
      const { data: userData } = await supabase
        .from("users")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .single();
      const helperName = userData?.full_name || "Someone";
      const helperAvatar = userData?.avatar_url;
      // Send initial "on the way" notification
      await createNotification({
        userId: sos.user_id,
        type: "sos_alert",
        title: "Help is on the way!",
        body: `${helperName} is coming to help you. ETA: ${eta} minutes`,
        data: {
          sos_id: sos.id,
          helper_id: user.id,
          helper_name: helperName,
          helper_avatar: helperAvatar || null,
          helper_lat: userLocation.lat,
          helper_lng: userLocation.lng,
          eta_minutes: eta,
        },
      });
      // Mark this SOS as helped and persist
      setHelpedSOSIds(prev => {
        const newSet = new Set(prev);
        newSet.add(sos.id);
        try { localStorage.setItem(HELPED_SOS_KEY, JSON.stringify([...newSet])); } catch {}
        return newSet;
      });
      // Start milestone-based location tracking
      startHelperLocationTracking(sos.user_id, sos.id, helperName, helperAvatar);
            // Start native background tracking for helper
      try {
        const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
        if (isCapacitor) {
          const { data: authData } = await supabase.auth.getSession();
          const token = authData.session?.access_token;
          if (token) {
            await SOSLocation.startTracking({
              sosId: sos.id,
              supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
              supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
              accessToken: token,
              mode: 'helper',
              helperId: user.id,
              sosOwnerId: sos.user_id,
              helperName: helperName,
            });
          }
        }
      } catch (e) {
      }
      setToast(`Thank you! ${sos.user?.full_name || "The person"} has been notified. ETA: ${eta} minutes.`);
      setTimeout(() => setToast(null), 3000);
      setSelectedSOS(null);
    } catch (err) {
      setToast("Failed to notify. Please try again.");
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSendingHelp(false);
    }
  };
  // =====================================================================
  // RESTART HELPER TRACKING ON PAGE LOAD (for helper's device)
  // Runs ONCE on mount. Does NOT depend on userLocation.
  // =====================================================================
  useEffect(() => {
    if (!user) return;
    if (restartedRef.current) return;
    restartedRef.current = true;
    const checkAndRestartTracking = async () => {
      const helpedIds = Array.from(helpedSOSIds);
      if (helpedIds.length === 0) return;
      for (const sosId of helpedIds) {
        // Check if this SOS is still active
        const { data: sosData } = await supabase
          .from("sos_alerts")
          .select("id, user_id, status, latitude, longitude")
          .eq("id", sosId)
          .eq("status", "active")
          .maybeSingle();
        if (sosData) {
          // Get user data for tracking
          const { data: userData } = await supabase
            .from("users")
            .select("full_name, avatar_url")
            .eq("id", user.id)
            .single();
          startHelperLocationTracking(
            sosData.user_id,
            sosId,
            userData?.full_name || "Someone",
            userData?.avatar_url
          );
        } else {
          // SOS is no longer active, remove from helped list + clean up milestones
          clearFiredMilestones(sosId, user.id);
          setHelpedSOSIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(sosId);
            try { localStorage.setItem(HELPED_SOS_KEY, JSON.stringify([...newSet])); } catch {}
            return newSet;
          });
        }
      }
    };
    checkAndRestartTracking();
  }, [user?.id, startHelperLocationTracking]);
  // =====================================================================
  // CLEANUP ALL WATCHERS ON UNMOUNT
  // =====================================================================
  useEffect(() => {
    return () => {
      // Clear all GPS watchers
      for (const sosId of Object.keys(helperWatchIdsRef.current)) {
        navigator.geolocation.clearWatch(helperWatchIdsRef.current[sosId]);
      }
      helperWatchIdsRef.current = {};
      // Clear all timeouts
      for (const sosId of Object.keys(helperTimeoutsRef.current)) {
        clearTimeout(helperTimeoutsRef.current[sosId]);
      }
      helperTimeoutsRef.current = {};
    };
  }, []);
  // Handle map move
  const handleMove = useCallback((evt: { viewState: ViewState }) => {
    setViewState(evt.viewState);
  }, []);
  const handleInteractionStart = useCallback(() => {
    isUserInteracting.current = true;
    if (interactionTimeout.current) clearTimeout(interactionTimeout.current);
  }, []);
  const handleInteractionEnd = useCallback(() => {
    interactionTimeout.current = setTimeout(() => {
      isUserInteracting.current = false;
      currentBearing.current = viewState.bearing;
    }, 300);
  }, [viewState.bearing]);
  // General cleanup
  useEffect(() => {
    return () => {
      if (interactionTimeout.current) clearTimeout(interactionTimeout.current);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, []);
  const isOwnSOS = selectedSOS && myUserId && selectedSOS.user_id === myUserId;
  const tagInfo = selectedSOS?.tag ? SOS_TAGS.find(t => t.id === selectedSOS.tag) : null;
  return (
    <>
      <MapGL
        ref={mapRef}
        {...viewState}
        onMove={handleMove}
        onDragStart={handleInteractionStart}
        onDragEnd={handleInteractionEnd}
        onZoomStart={handleInteractionStart}
        onZoomEnd={handleInteractionEnd}
        onRotateStart={handleInteractionStart}
        onRotateEnd={handleInteractionEnd}
        onPitchStart={handleInteractionStart}
        onPitchEnd={handleInteractionEnd}
        dragRotate={true}
        touchZoomRotate={true}
        style={{ width: "100%", height: "100%" }}
        mapStyle={{
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: [
                "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
                "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
                "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
              ],
              tileSize: 256,
              attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        }}
        maxZoom={18}
        minZoom={3}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {/* Post/Incident Markers */}
        {posts.map(post => {
          if (!post.location?.latitude || !post.location?.longitude) return null;
          const color = getCategoryColor(post.category);
          return (
            <Marker
              key={post.id}
              longitude={post.location.longitude}
              latitude={post.location.latitude}
              anchor="bottom"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                onPostClick(post.id);
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: color,
                  borderRadius: "50% 50% 50% 0",
                  transform: "rotate(-45deg)",
                  border: "3px solid white",
                  boxShadow: "0 3px 12px rgba(0,0,0,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    background: "white",
                    borderRadius: "50%",
                    transform: "rotate(45deg)",
                  }}
                />
              </div>
            </Marker>
          );
        })}
        {/* SOS Markers */}
        {liveSOSAlerts.map(sos => {
          const avatarUrl = sos.user?.avatar_url || "https://ui-avatars.com/api/?name=SOS&background=dc2626&color=fff";
          const sosBearing = sos.bearing || 0;
          return (
            <Marker
              key={sos.id}
              longitude={sos.longitude}
              latitude={sos.latitude}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelectedSOS(sos);
              }}
            >
              <div className="sos-marker-wrapper" style={{ position: "relative", width: 56, height: 56, cursor: "pointer" }}>
                <div className="sos-glow-ring" />
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    transform: `rotate(${sosBearing}deg)`,
                    transition: "transform 0.3s ease-out",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 2,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 0,
                      height: 0,
                      borderLeft: "8px solid transparent",
                      borderRight: "8px solid transparent",
                      borderBottom: "12px solid #dc2626",
                      zIndex: 3,
                    }}
                  />
                </div>
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    overflow: "hidden",
                    border: "3px solid #dc2626",
                    background: "white",
                    zIndex: 2,
                  }}
                >
                  <img
                    src={avatarUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "https://ui-avatars.com/api/?name=SOS&background=dc2626&color=fff";
                    }}
                  />
                </div>
              </div>
            </Marker>
          );
        })}
        {/* Helper Markers — ALL helpers show, not just one */}
        {helpers.map(helper => {
          const avatarUrl = helper.avatar_url || "https://ui-avatars.com/api/?name=H&background=22c55e&color=fff";
          return (
            <Marker
              key={`helper-${helper.id}-${helper.sosId}`}
              longitude={helper.lng}
              latitude={helper.lat}
              anchor="center"
            >
              <div style={{ position: "relative", width: 48, height: 48 }}>
                <div className="helper-glow-ring" />
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    overflow: "hidden",
                    border: "3px solid #22c55e",
                    background: "white",
                    zIndex: 2,
                  }}
                >
                  <img
                    src={avatarUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
              </div>
            </Marker>
          );
        })}
        {/* User Location Marker */}
        {userLocation && (
          <Marker
            longitude={userLocation.lng}
            latitude={userLocation.lat}
            anchor="center"
          >
            <div style={{ position: "relative", width: 48, height: 48 }}>
              {compassEnabled && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    transform: "rotate(0deg)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 2,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 0,
                      height: 0,
                      borderLeft: "8px solid transparent",
                      borderRight: "8px solid transparent",
                      borderBottom: "12px solid #7c3aed",
                      zIndex: 3,
                    }}
                  />
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 18,
                  height: 18,
                  background: "#7c3aed",
                  border: "3px solid white",
                  borderRadius: "50%",
                  boxShadow: "0 0 0 4px rgba(124,58,237,0.25)",
                  zIndex: 2,
                }}
              />
            </div>
          </Marker>
        )}
      </MapGL>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-3000 glass-float px-4 py-2 rounded-xl text-dark-100">
          {toast}
        </div>
      )}
      {/* SOS Details Modal */}
      {selectedSOS && (
        <div className="fixed inset-0 z-5000 flex items-start justify-center overflow-hidden">
          <div className="absolute inset-0 bg-black/80" onClick={() => setSelectedSOS(null)} />
          <div
            ref={modalContentRef}
            className="relative glass-strong w-full h-full max-w-lg overflow-hidden flex flex-col"
            style={{ paddingTop: "var(--cap-status-bar-height, 0px)" }}
          >
            {/* User Info Header */}
            <div className="border-b border-white/10 p-4 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xl font-bold text-white">
                  {isOwnSOS ? "Your SOS Alert" : "SOS Alert"}
                </h3>
                <button
                  onClick={() => setSelectedSOS(null)}
                  className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-lg text-dark-400 text-xl"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                <div className="w-14 h-14 rounded-full overflow-hidden border-3 border-red-500 shrink-0 sos-avatar-glow">
                  <img
                    src={selectedSOS.user?.avatar_url || "https://ui-avatars.com/api/?name=User"}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white truncate text-lg">
                    {isOwnSOS ? "You" : (selectedSOS.user?.full_name || "Someone")}
                  </p>
                  <p className="text-sm text-dark-400 truncate">
                    {selectedSOS.address || "Location unavailable"}
                  </p>
                  <p className="text-xs text-dark-500">
                    {formatDistanceToNow(new Date(selectedSOS.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            </div>
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-green-400">Live tracking active</span>
              </div>
              {tagInfo && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <p className="text-sm text-dark-400">Situation:</p>
                  <p className="font-semibold text-white">{tagInfo.label}</p>
                </div>
              )}
              {selectedSOS.message && (
                <div className="p-3 bg-white/5 rounded-xl">
                  <p className="text-sm text-dark-400 mb-1">Message:</p>
                  <p className="text-white">{selectedSOS.message}</p>
                </div>
              )}
              {tagInfo && !isOwnSOS && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                  <p className="text-sm font-medium text-yellow-400 mb-1">How to help:</p>
                  <p className="text-sm text-yellow-200">{tagInfo.suggestion}</p>
                </div>
              )}
              {/* Show helpers coming (for own SOS) */}
              {isOwnSOS && helpers.length > 0 && (
                <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
                  <p className="text-sm font-medium text-green-400 mb-3">
                    {helpers.length} {helpers.length === 1 ? "person" : "people"} coming to help:
                  </p>
                  <div className="space-y-3">
                    {helpers.map(helper => (
                      <div key={helper.id} className="flex items-center gap-3 p-2 bg-green-500/10 rounded-lg">
                        <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-green-500 shrink-0">
                          <img
                            src={helper.avatar_url || "https://ui-avatars.com/api/?name=H&background=22c55e&color=fff"}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{helper.name}</p>
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            <p className="text-xs text-green-400">ETA: {helper.eta} min</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-green-400">{helper.eta}</p>
                          <p className="text-xs text-dark-500">min</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-dark-500 mt-2">
                    Helper locations are shown on the map with green markers
                  </p>
                </div>
              )}
              {/* ETA for helpers */}
              {!isOwnSOS && userLocation && (
                <div className="text-center py-3 bg-primary-500/10 rounded-xl">
                  <p className="text-sm text-dark-400">Your estimated arrival time:</p>
                  <p className="text-4xl font-bold text-primary-400">
                    {calculateETA(userLocation.lat, userLocation.lng, selectedSOS.latitude, selectedSOS.longitude)}
                  </p>
                  <p className="text-sm text-dark-500">minutes</p>
                </div>
              )}
              {/* Emergency Call Buttons */}
              <div className="flex gap-2">
                <a href="tel:112" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium text-center">
                  Call 112
                </a>
                <a href="tel:767" className="flex-1 py-3 bg-red-500 text-white rounded-xl font-medium text-center">
                  Call 767
                </a>
              </div>
              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setSelectedSOS(null)}
                  className="flex-1 py-3 bg-dark-700 text-dark-300 rounded-xl font-medium"
                >
                  Back
                </button>
                {!isOwnSOS && !helpedSOSIds.has(selectedSOS.id) && (
                  <button
                    onClick={() => handleICanHelp(selectedSOS)}
                    disabled={sendingHelp}
                    className="flex-1 py-3 bg-green-600 text-white rounded-xl font-medium disabled:opacity-50"
                  >
                    {sendingHelp ? "Sending..." : "I Can Help"}
                  </button>
                )}
                {!isOwnSOS && helpedSOSIds.has(selectedSOS.id) && (
                  <div className="flex-1 py-3 bg-green-600/20 text-green-400 rounded-xl font-medium text-center flex items-center justify-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    You're Helping
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
