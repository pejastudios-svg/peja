"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import L from "leaflet";
import { Post, CATEGORIES, SOSAlert } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { useAuth } from "@/context/AuthContext";

// Fix Leaflet default icon issue
if (typeof window !== "undefined") {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

// SOS Tags
const SOS_TAGS = [
  { id: "medical", label: "Medical Emergency", suggestion: "Call an ambulance or get the person to a hospital immediately." },
  { id: "accident", label: "Car Accident", suggestion: "Check for injuries. Do not move injured unless necessary." },
  { id: "robbery", label: "Armed Robbery", suggestion: "DANGER: Do NOT approach. Contact police at 112 or 767." },
  { id: "kidnapping", label: "Kidnapping", suggestion: "EXTREME DANGER: Do NOT approach. Contact police immediately." },
  { id: "fire", label: "Fire", suggestion: "Call fire service. Evacuate the area. Do not enter burning buildings." },
  { id: "assault", label: "Physical Assault", suggestion: "Ensure scene is safe. Call police and provide first aid if trained." },
  { id: "flood", label: "Flooding", suggestion: "Avoid flooded areas. Help evacuate to higher ground if safe." },
  { id: "stuck", label: "Stuck or Stranded", suggestion: "User may need transport or help. Safe to approach." },
  { id: "health", label: "Health Crisis", suggestion: "Person may need medication. Ask before administering help." },
  { id: "other", label: "Other Emergency", suggestion: "Assess carefully. Your safety comes first." },
];

interface IncidentMapInnerProps {
  posts: Post[];
  userLocation: { lat: number; lng: number } | null;
  onPostClick: (postId: string) => void;
  sosAlerts?: SOSAlert[];
  onSOSClick?: (id: string) => void;
  centerOnUser?: boolean;
  centerOnCoords?: { lat: number; lng: number } | null;
  openSOSId?: string | null;
}

// Create icons
const createIncidentIcon = (color: string) => {
  return L.divIcon({
    className: "incident-marker",
    html: `
      <div style="
        width: 32px;
        height: 32px;
        background: ${color};
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid white;
        box-shadow: 0 3px 12px rgba(0,0,0,0.4);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          width: 8px;
          height: 8px;
          background: white;
          border-radius: 50%;
          transform: rotate(45deg);
        "></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });
};

const createUserLocationIcon = (bearing: number) => {
  return L.divIcon({
    className: "user-location-marker",
    html: `
      <div style="position: relative; width: 48px; height: 48px;">
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          transform: rotate(${bearing}deg);
          transition: transform 0.3s ease-out;
        ">
          <div style="
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-bottom: 14px solid #7c3aed;
          "></div>
        </div>
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 18px;
          height: 18px;
          background: #7c3aed;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 0 0 4px rgba(124,58,237,0.25);
          z-index: 2;
        "></div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -24],
  });
};

const createSOSIcon = (avatarUrl?: string, bearing = 0) => {
  const img = avatarUrl || "https://ui-avatars.com/api/?name=SOS&background=dc2626&color=fff";
  return L.divIcon({
    className: "sos-marker",
    html: `
      <div style="position: relative; width: 64px; height: 64px;">
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          transform: rotate(${bearing}deg);
        ">
          <div style="
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 10px solid transparent;
            border-right: 10px solid transparent;
            border-bottom: 16px solid #dc2626;
          "></div>
        </div>
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 40px;
          height: 40px;
          border-radius: 50%;
          overflow: hidden;
          border: 4px solid #dc2626;
          box-shadow: 0 0 0 4px rgba(220,38,38,0.25);
          background: white;
          z-index: 2;
        ">
          <img src="${img}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://ui-avatars.com/api/?name=SOS&background=dc2626&color=fff'" />
        </div>
      </div>
    `,
    iconSize: [64, 64],
    iconAnchor: [32, 32],
    popupAnchor: [0, -32],
  });
};

const dangerIcon = createIncidentIcon("#ef4444");
const warningIcon = createIncidentIcon("#f97316");
const awarenessIcon = createIncidentIcon("#eab308");
const infoIcon = createIncidentIcon("#3b82f6");

function calculateETA(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const R = 6371;
  const dLat = (toLat - fromLat) * Math.PI / 180;
  const dLng = (toLng - fromLng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(fromLat * Math.PI / 180) * Math.cos(toLat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Math.max(1, Math.round((distance / 30) * 60));
}

export default function IncidentMapInner({
  posts,
  userLocation,
  onPostClick,
  sosAlerts = [],
  onSOSClick,
  centerOnUser = false,
  centerOnCoords = null,
  openSOSId = null,
}: IncidentMapInnerProps) {
  const { user } = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const autoOpenedRef = useRef(false);
  const sosMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  
  const [selectedSOS, setSelectedSOS] = useState<SOSAlert | null>(null);
  const [sendingHelp, setSendingHelp] = useState(false);
  const [liveSOSAlerts, setLiveSOSAlerts] = useState<SOSAlert[]>(sosAlerts);
  const [bearing, setBearing] = useState(0);

  const defaultCenter: [number, number] = [6.5244, 3.3792];
  const center = useMemo(() => 
    userLocation ? [userLocation.lat, userLocation.lng] as [number, number] : defaultCenter,
    [userLocation]
  );

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Create map instance
    const map = L.map(mapContainerRef.current, {
      center: center,
      zoom: 14,
      zoomControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    mapInstanceRef.current = map;

    // Cleanup on unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
  if (!openSOSId) return;
  if (autoOpenedRef.current) return;

  const match = liveSOSAlerts.find((s) => s.id === openSOSId);
  if (match) {
    setSelectedSOS(match);
    autoOpenedRef.current = true;
  }
}, [openSOSId, liveSOSAlerts]);

  // Center on user when requested
  useEffect(() => {
    if (centerOnUser && mapInstanceRef.current && userLocation) {
      mapInstanceRef.current.setView([userLocation.lat, userLocation.lng], 16, { animate: true });
    }
  }, [centerOnUser, userLocation]);

  useEffect(() => {
  if (!centerOnCoords || !mapInstanceRef.current) return;
  mapInstanceRef.current.setView([centerOnCoords.lat, centerOnCoords.lng], 16, { animate: true });
}, [centerOnCoords]);

useEffect(() => {
  if (!openSOSId) return;
  const match = liveSOSAlerts.find(s => s.id === openSOSId);
  if (match) setSelectedSOS(match);
}, [openSOSId, liveSOSAlerts]);

  // Update user location marker
  useEffect(() => {
    if (!mapInstanceRef.current || !userLocation) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
      userMarkerRef.current.setIcon(createUserLocationIcon(bearing));
    } else {
      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], {
        icon: createUserLocationIcon(bearing),
      }).addTo(mapInstanceRef.current);
      
      userMarkerRef.current.bindPopup("<div class='text-center p-1'><p class='font-medium text-gray-800'>You are here</p></div>");
    }
  }, [userLocation, bearing]);

  // Update post markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Remove old markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Add new markers
    posts.forEach(post => {
      if (!post.location?.latitude || !post.location?.longitude) return;

      const category = CATEGORIES.find(c => c.id === post.category);
      let icon = infoIcon;
      switch (category?.color) {
        case "danger": icon = dangerIcon; break;
        case "warning": icon = warningIcon; break;
        case "awareness": icon = awarenessIcon; break;
      }

      const marker = L.marker([post.location.latitude, post.location.longitude], { icon })
        .addTo(mapInstanceRef.current!);
      
      marker.on("click", () => onPostClick(post.id));
      markersRef.current.push(marker);
    });
  }, [posts, onPostClick]);

  // Update SOS markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Update existing markers or add new ones
    liveSOSAlerts.forEach(sos => {
      const existingMarker = sosMarkersRef.current.get(sos.id);
      
      if (existingMarker) {
        existingMarker.setLatLng([sos.latitude, sos.longitude]);
        existingMarker.setIcon(createSOSIcon(sos.user?.avatar_url, sos.bearing || 0));
      } else {
        const marker = L.marker([sos.latitude, sos.longitude], {
          icon: createSOSIcon(sos.user?.avatar_url, sos.bearing || 0),
        }).addTo(mapInstanceRef.current!);
        
        marker.on("click", () => setSelectedSOS(sos));
        
        marker.bindPopup(`
          <div class="text-center p-2 min-w-[200px]">
            <p class="font-bold text-red-600 text-lg">SOS Alert</p>
            <p class="font-medium text-gray-800">${sos.user?.full_name || "Someone"}</p>
            <p class="text-xs text-gray-500 mt-1">${sos.address || "Location unavailable"}</p>
          </div>
        `);
        
        sosMarkersRef.current.set(sos.id, marker);
      }
    });

    // Remove markers for SOS that no longer exist
    sosMarkersRef.current.forEach((marker, id) => {
      if (!liveSOSAlerts.find(s => s.id === id)) {
        marker.remove();
        sosMarkersRef.current.delete(id);
      }
    });
  }, [liveSOSAlerts]);

  // Update SOS alerts from props
  useEffect(() => {
    setLiveSOSAlerts(sosAlerts);
  }, [sosAlerts]);

  // Real-time SOS updates
  useEffect(() => {
    const channel = supabase
      .channel("sos-map-realtime")
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedSOS?.id]);

  // Compass bearing
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      let newBearing = 0;
      if ((event as any).webkitCompassHeading !== undefined) {
        newBearing = (event as any).webkitCompassHeading;
      } else if (event.alpha !== null) {
        newBearing = 360 - event.alpha;
      }
      setBearing(((newBearing % 360) + 360) % 360);
    };

    if (typeof (DeviceOrientationEvent as any).requestPermission === "function") {
      (DeviceOrientationEvent as any).requestPermission()
        .then((response: string) => {
          if (response === "granted") {
            window.addEventListener("deviceorientation", handleOrientation, true);
          }
        })
        .catch(console.error);
    } else {
      window.addEventListener("deviceorientation", handleOrientation, true);
    }

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, []);

  const handleICanHelp = async (sos: SOSAlert) => {
    if (!user || !userLocation) {
      alert("Please enable location to help");
      return;
    }

    setSendingHelp(true);
    try {
      const eta = calculateETA(userLocation.lat, userLocation.lng, sos.latitude, sos.longitude);
      await createNotification({
        userId: sos.user_id,
        type: "sos_alert",
        title: "Help is on the way!",
        body: `Someone is coming to help you. ETA: ${eta} minutes`,
        data: { sos_id: sos.id, helper_id: user.id, eta_minutes: eta },
      });
      alert(`Thank you! The person has been notified. Your ETA: ${eta} minutes.`);
      setSelectedSOS(null);
    } catch (err) {
      console.error("Error:", err);
      alert("Failed to notify. Please try again.");
    } finally {
      setSendingHelp(false);
    }
  };

  const tagInfo = selectedSOS?.tag ? SOS_TAGS.find(t => t.id === selectedSOS.tag) : null;

  return (
    <>
      <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

      {/* SOS Details Modal */}
      {selectedSOS && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setSelectedSOS(null)} />
          <div className="relative bg-dark-900 border border-white/10 rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-dark-900 border-b border-white/10 p-4 flex items-center justify-between z-10">
              <div>
                <h3 className="text-xl font-bold text-white">SOS Alert</h3>
                <p className="text-sm text-dark-400">
                  {formatDistanceToNow(new Date(selectedSOS.created_at), { addSuffix: true })}
                </p>
              </div>
              <button
                onClick={() => setSelectedSOS(null)}
                className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-lg text-dark-400 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-red-500 flex-shrink-0">
                  <img
                    src={selectedSOS.user?.avatar_url || "https://ui-avatars.com/api/?name=User"}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">
                    {selectedSOS.user?.full_name || "Someone"}
                  </p>
                  <p className="text-sm text-dark-400 truncate">
                    {selectedSOS.address || "Location unavailable"}
                  </p>
                </div>
              </div>

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

              {selectedSOS.voice_note_url && (
                <div>
                  <p className="text-sm text-dark-400 mb-2">Voice Note:</p>
                  <audio src={selectedSOS.voice_note_url} controls className="w-full" />
                </div>
              )}

              {tagInfo && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                  <p className="text-sm font-medium text-yellow-400 mb-1">How to help:</p>
                  <p className="text-sm text-yellow-200">{tagInfo.suggestion}</p>
                </div>
              )}

              {userLocation && (
                <div className="text-center py-2">
                  <p className="text-sm text-dark-400">Your estimated arrival time:</p>
                  <p className="text-3xl font-bold text-primary-400">
                    {calculateETA(userLocation.lat, userLocation.lng, selectedSOS.latitude, selectedSOS.longitude)} min
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <a href="tel:112" className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium text-center">
                  Call 112
                </a>
                <a href="tel:767" className="flex-1 py-3 bg-red-500 text-white rounded-xl font-medium text-center">
                  Call 767
                </a>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setSelectedSOS(null)}
                  className="flex-1 py-3 bg-dark-700 text-dark-300 rounded-xl font-medium"
                >
                  Back
                </button>
                <button
                  onClick={() => handleICanHelp(selectedSOS)}
                  disabled={sendingHelp}
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl font-medium disabled:opacity-50"
                >
                  {sendingHelp ? "Sending..." : "I Can Help"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}