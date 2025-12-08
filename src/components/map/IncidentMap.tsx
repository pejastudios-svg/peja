"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { Post, CATEGORIES } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { useAuth } from "@/context/AuthContext";

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

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

// Types
interface SOSAlert {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  address?: string;
  status: string;
  created_at: string;
  last_updated?: string;
  tag?: string;
  voice_note_url?: string;
  message?: string;
  user?: {
    full_name: string;
    avatar_url?: string;
  };
}

interface IncidentMapProps {
  posts: Post[];
  userLocation: { lat: number; lng: number } | null;
  onPostClick: (id: string) => void;
  sosAlerts?: SOSAlert[];
  onSOSClick?: (id: string) => void;
  centerOnUser?: boolean;
}

// Incident marker icons
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

const dangerIcon = createIncidentIcon("#ef4444");
const warningIcon = createIncidentIcon("#f97316");
const awarenessIcon = createIncidentIcon("#eab308");
const infoIcon = createIncidentIcon("#3b82f6");

// =====================================================
// USER LOCATION MARKER - Arrow orbits around circle
// =====================================================
const createUserLocationIcon = (bearing: number) => {
  return L.divIcon({
    className: "user-location-marker",
    html: `
      <div style="position: relative; width: 48px; height: 48px;">
        <!-- Rotating container - arrow orbits around center -->
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          transform: rotate(${bearing}deg);
          transition: transform 0.2s ease-out;
        ">
          <!-- Arrow at top, pointing outward -->
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
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
          "></div>
        </div>
        
        <!-- Circle stays fixed in center -->
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
          box-shadow: 0 0 0 4px rgba(124,58,237,0.25), 0 2px 6px rgba(0,0,0,0.3);
          z-index: 2;
        "></div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -24],
  });
};

// =====================================================
// SOS MARKER - Arrow orbits around profile picture
// =====================================================
const createSOSIcon = (avatarUrl?: string, bearing = 0) => {
  const img = avatarUrl || "https://ui-avatars.com/api/?name=SOS&background=dc2626&color=fff";

  return L.divIcon({
    className: "sos-marker",
    html: `
      <div style="position: relative; width: 64px; height: 64px;">
        <!-- Rotating container - arrow orbits around center -->
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          transform: rotate(${bearing}deg);
          transition: transform 0.2s ease-out;
        ">
          <!-- Arrow at top, pointing outward -->
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
            filter: drop-shadow(0 1px 3px rgba(0,0,0,0.3));
          "></div>
        </div>
        
        <!-- Profile picture stays fixed in center -->
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
          box-shadow: 0 0 0 4px rgba(220,38,38,0.25), 0 3px 10px rgba(0,0,0,0.4);
          background: white;
          z-index: 2;
        ">
          <img src="${img}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://ui-avatars.com/api/?name=SOS&background=dc2626&color=fff'" />
        </div>
        
        <!-- Pulsing Ring -->
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 3px solid #dc2626;
          animation: sos-pulse-ring 2s infinite;
          pointer-events: none;
          z-index: 1;
        "></div>
      </div>
      
      <style>
        @keyframes sos-pulse-ring {
          0% { 
            transform: translate(-50%, -50%) scale(1); 
            opacity: 1; 
          }
          100% { 
            transform: translate(-50%, -50%) scale(2); 
            opacity: 0; 
          }
        }
      </style>
    `,
    iconSize: [64, 64],
    iconAnchor: [32, 32],
    popupAnchor: [0, -32],
  });
};

// Map controller - prevents jumping on re-render
function MapController({ center, shouldCenter }: { center: [number, number]; shouldCenter: boolean }) {
  const map = useMap();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      map.setView(center, 14, { animate: false });
      initialized.current = true;
    } else if (shouldCenter) {
      map.setView(center, 16, { animate: true });
    }
  }, [center, shouldCenter, map]);

  return null;
}

// Calculate ETA in minutes
function calculateETA(
  fromLat: number, 
  fromLng: number, 
  toLat: number, 
  toLng: number
): number {
  const R = 6371;
  const dLat = (toLat - fromLat) * Math.PI / 180;
  const dLng = (toLng - fromLng) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(fromLat * Math.PI / 180) * Math.cos(toLat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  const minutes = Math.round((distance / 30) * 60);
  return Math.max(1, minutes);
}

// =====================================================
// REAL-TIME COMPASS BEARING HOOK
// =====================================================
function useBearing() {
  const [bearing, setBearing] = useState(0);
  const lastBearing = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let permissionGranted = false;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      let newBearing = 0;
      
      // iOS Safari
      if ((event as any).webkitCompassHeading !== undefined) {
        newBearing = (event as any).webkitCompassHeading;
      } 
      // Android Chrome
      else if (event.alpha !== null) {
        newBearing = 360 - event.alpha;
      }

      // Normalize to 0-360
      newBearing = ((newBearing % 360) + 360) % 360;
      
      // Only update if bearing changed significantly (reduces jitter)
      if (Math.abs(newBearing - lastBearing.current) > 3) {
        lastBearing.current = newBearing;
        setBearing(newBearing);
      }
    };

    const startListening = () => {
      window.addEventListener("deviceorientation", handleOrientation, true);
    };

    // Request permission on iOS 13+
    if (typeof (DeviceOrientationEvent as any).requestPermission === "function") {
      (DeviceOrientationEvent as any).requestPermission()
        .then((response: string) => {
          if (response === "granted") {
            permissionGranted = true;
            startListening();
          }
        })
        .catch((err: any) => {
          console.warn("Compass permission error:", err);
        });
    } else {
      // Android and older iOS
      startListening();
    }

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, []);

  return bearing;
}

// =====================================================
// MAIN MAP COMPONENT
// =====================================================
export default function IncidentMap({
  posts,
  userLocation,
  onPostClick,
  sosAlerts = [],
  onSOSClick,
  centerOnUser = false,
}: IncidentMapProps) {
  const router = useRouter();
  const { user } = useAuth();
  const bearing = useBearing();
  const [selectedSOS, setSelectedSOS] = useState<SOSAlert | null>(null);
  const [sendingHelp, setSendingHelp] = useState(false);
  
  const defaultCenter: [number, number] = [6.5244, 3.3792];
  const center: [number, number] = userLocation 
    ? [userLocation.lat, userLocation.lng] 
    : defaultCenter;

  const getIcon = (categoryId: string) => {
    const category = CATEGORIES.find(c => c.id === categoryId);
    switch (category?.color) {
      case "danger": return dangerIcon;
      case "warning": return warningIcon;
      case "awareness": return awarenessIcon;
      default: return infoIcon;
    }
  };

  const handleICanHelp = async (sos: SOSAlert) => {
    if (!user || !userLocation) {
      alert("Please enable location to help");
      return;
    }

    setSendingHelp(true);

    try {
      const eta = calculateETA(
        userLocation.lat, 
        userLocation.lng, 
        sos.latitude, 
        sos.longitude
      );

      // Notify the SOS user
      await createNotification({
        userId: sos.user_id,
        type: "sos_alert",
        title: "Help is on the way!",
        body: `Someone is coming to help you. ETA: ${eta} minutes`,
        data: { 
          sos_id: sos.id, 
          helper_id: user.id,
          eta_minutes: eta,
        },
      });

      // Notify other nearby users that someone is helping
      const { data: nearbyUsers } = await supabase
        .from("users")
        .select("id")
        .neq("id", user.id)
        .neq("id", sos.user_id)
        .eq("status", "active")
        .limit(30);

      if (nearbyUsers) {
        for (const nearbyUser of nearbyUsers) {
          await createNotification({
            userId: nearbyUser.id,
            type: "sos_alert",
            title: "Someone is responding to the SOS",
            body: `A Peja user is heading to help. You can also assist if nearby.`,
            data: { sos_id: sos.id },
          });
        }
      }

      alert(`Thank you! The person has been notified. Your ETA: ${eta} minutes.`);
      setSelectedSOS(null);

    } catch (err) {
      console.error("Error sending help notification:", err);
      alert("Failed to notify. Please try again.");
    } finally {
      setSendingHelp(false);
    }
  };

  const tagInfo = selectedSOS?.tag 
    ? SOS_TAGS.find(t => t.id === selectedSOS.tag) 
    : null;

  return (
    <>
      <MapContainer 
        center={center} 
        zoom={14} 
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        
        <MapController center={center} shouldCenter={centerOnUser} />

        {/* User Location with Orbiting Directional Arrow */}
        {userLocation && (
          <Marker 
            position={[userLocation.lat, userLocation.lng]} 
            icon={createUserLocationIcon(bearing)}
          >
            <Popup>
              <div className="text-center p-1">
                <p className="font-medium text-gray-800">You are here</p>
              </div>
            </Popup>
          </Marker>
        )}

        {/* SOS Alerts with Orbiting Directional Arrows */}
        {sosAlerts.map((sos) => (
          <Marker
            key={sos.id}
            position={[sos.latitude, sos.longitude]}
            icon={createSOSIcon(sos.user?.avatar_url, 0)}
            eventHandlers={{
              click: () => setSelectedSOS(sos),
            }}
          >
            <Popup>
              <div className="text-center p-2 min-w-[200px]">
                <p className="font-bold text-red-600 text-lg">SOS Alert</p>
                <p className="font-medium text-gray-800">{sos.user?.full_name || "Someone"}</p>
                <p className="text-xs text-gray-500 mt-1">{sos.address || "Location unavailable"}</p>
                <button
                  onClick={() => setSelectedSOS(sos)}
                  className="mt-3 w-full py-2 bg-red-600 text-white rounded-lg text-sm font-medium"
                >
                  View Details
                </button>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Post Markers */}
        {posts.map((post) => {
          if (!post.location?.latitude || !post.location?.longitude) return null;
          
          return (
            <Marker
              key={post.id}
              position={[post.location.latitude, post.location.longitude]}
              icon={getIcon(post.category)}
              eventHandlers={{ click: () => onPostClick(post.id) }}
            />
          );
        })}
      </MapContainer>

      {/* SOS Details Modal */}
      {selectedSOS && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/70" 
            onClick={() => setSelectedSOS(null)} 
          />
          <div className="relative bg-dark-900 border border-white/10 rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto">
            {/* Header */}
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
              {/* User Info */}
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-red-500 flex-shrink-0">
                  <img 
                    src={selectedSOS.user?.avatar_url || "https://ui-avatars.com/api/?name=User"} 
                    alt="" 
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{selectedSOS.user?.full_name || "Someone"}</p>
                  <p className="text-sm text-dark-400 truncate">{selectedSOS.address || "Location unavailable"}</p>
                </div>
              </div>

              {/* Situation Tag */}
              {tagInfo && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                  <p className="text-sm text-dark-400">Situation:</p>
                  <p className="font-semibold text-white">{tagInfo.label}</p>
                </div>
              )}

              {/* Text Message */}
              {selectedSOS.message && (
                <div className="p-3 bg-white/5 rounded-xl">
                  <p className="text-sm text-dark-400 mb-1">Message:</p>
                  <p className="text-white">{selectedSOS.message}</p>
                </div>
              )}

              {/* Voice Note */}
              {selectedSOS.voice_note_url && (
                <div>
                  <p className="text-sm text-dark-400 mb-2">Voice message:</p>
                  <audio src={selectedSOS.voice_note_url} controls className="w-full" />
                </div>
              )}

              {/* Suggestion */}
              {tagInfo && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                  <p className="text-sm font-medium text-yellow-400 mb-1">How to help:</p>
                  <p className="text-sm text-yellow-200">{tagInfo.suggestion}</p>
                </div>
              )}

              {/* Disclaimer */}
              <div className="p-3 bg-white/5 rounded-xl">
                <p className="text-xs text-dark-400">
                  We urge you to help fellow Nigerians in need. However, please only click "I Can Help" 
                  if you genuinely intend to assist. Your safety is important — do not put yourself in danger.
                </p>
              </div>

              {/* ETA */}
              {userLocation && (
                <div className="text-center py-2">
                  <p className="text-sm text-dark-400">Your estimated arrival time:</p>
                  <p className="text-3xl font-bold text-primary-400">
                    {calculateETA(
                      userLocation.lat, 
                      userLocation.lng, 
                      selectedSOS.latitude, 
                      selectedSOS.longitude
                    )} min
                  </p>
                </div>
              )}

              {/* Emergency Call Buttons */}
              <div className="flex gap-2">
                <a 
                  href="tel:112" 
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-medium text-center"
                >
                  Call 112
                </a>
                <a 
                  href="tel:767" 
                  className="flex-1 py-3 bg-red-500 text-white rounded-xl font-medium text-center"
                >
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