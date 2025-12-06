"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { Post, CATEGORIES, SOSAlert } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// =====================================================
// CUSTOM MARKER ICONS
// =====================================================

// Create incident markers based on category color
const createCustomIcon = (color: string) => {
  return L.divIcon({
    className: "custom-marker",
    html: `
      <div style="
        width: 32px;
        height: 32px;
        background: ${color};
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
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

// Map category colors to actual hex colors
const dangerIcon = createCustomIcon("#ef4444");    // Red
const warningIcon = createCustomIcon("#f97316");   // Orange
const awarenessIcon = createCustomIcon("#eab308"); // Yellow
const infoIcon = createCustomIcon("#3b82f6");      // Blue

// =====================================================
// SOS MARKER WITH PROFILE PICTURE
// =====================================================
const createSOSMarkerIcon = (avatarUrl?: string) => {
  const imageHtml = avatarUrl
    ? `<img src="${avatarUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`
    : `<div style="width: 100%; height: 100%; background: #dc2626; display: flex; align-items: center; justify-content: center; font-size: 24px;">🚨</div>`;

  return L.divIcon({
    className: "custom-sos-marker",
    html: `
      <div class="sos-marker-wrapper">
        <div class="sos-marker-container">
          ${imageHtml}
        </div>
        <div class="sos-pulse"></div>
      </div>
      <style>
        .sos-marker-wrapper {
          position: relative;
          width: 50px;
          height: 50px;
        }
        
        .sos-marker-container {
          position: relative;
          width: 50px;
          height: 50px;
          border-radius: 50%;
          border: 4px solid #dc2626;
          overflow: hidden;
          background: white;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          animation: sos-bounce 1s infinite;
        }
        
        .sos-pulse {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: 50%;
          border: 3px solid #dc2626;
          animation: sos-pulse 2s infinite;
          pointer-events: none;
        }
        
        @keyframes sos-pulse {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(1.8);
            opacity: 0;
          }
        }
        
        @keyframes sos-bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }
      </style>
    `,
    iconSize: [50, 50],
    iconAnchor: [25, 50],
    popupAnchor: [0, -50],
  });
};

// =====================================================
// MAP UPDATER COMPONENT
// =====================================================
function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

// =====================================================
// USER LOCATION MARKER
// =====================================================
function UserLocationMarker({ position }: { position: [number, number] }) {
  const userIcon = L.divIcon({
    className: "user-marker",
    html: `
      <div style="
        width: 20px;
        height: 20px;
        background: #7c3aed;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 0 0 8px rgba(124, 58, 237, 0.2), 0 2px 8px rgba(0,0,0,0.3);
      "></div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  return (
    <Marker position={position} icon={userIcon}>
      <Popup>
        <div className="text-center">
          <p className="font-medium">You are here</p>
        </div>
      </Popup>
    </Marker>
  );
}

// =====================================================
// REAL-TIME SOS MARKER COMPONENT
// =====================================================
function RealtimeSOSMarker({ sos }: { sos: SOSAlert }) {
  const router = useRouter();
  const [position, setPosition] = useState<[number, number]>([sos.latitude, sos.longitude]);
  const [sosData, setSOSData] = useState(sos);

  useEffect(() => {
    // Subscribe to real-time updates for this specific SOS
    const channel = supabase
      .channel(`sos-${sos.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sos_alerts',
          filter: `id=eq.${sos.id}`,
        },
        (payload) => {
          console.log('📍 SOS location updated:', payload.new);
          const newData = payload.new as SOSAlert;
          
          // Smoothly update position
          setPosition([newData.latitude, newData.longitude]);
          setSOSData(newData);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sos.id]);

  return (
    <Marker
      position={position}
      icon={createSOSMarkerIcon(sosData.user?.avatar_url)}
      eventHandlers={{
        click: () => router.push(`/map?sos=${sos.id}`),
      }}
    >
      <Popup>
        <div className="min-w-[200px]">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
              🚨 SOS ALERT
            </span>
            <span className="flex items-center gap-1 text-xs text-red-600">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              ACTIVE
            </span>
          </div>
          
          <p className="text-sm font-semibold text-gray-700 mb-2">
            {sosData.user?.full_name || "Someone"} needs help!
          </p>
          
          {sosData.address && (
            <p className="text-xs text-gray-500 mb-2">
              📍 {sosData.address}
            </p>
          )}
          
          <p className="text-xs text-gray-500 mb-2">
            Last updated: {sosData.last_updated 
              ? formatDistanceToNow(new Date(sosData.last_updated), { addSuffix: true })
              : formatDistanceToNow(new Date(sosData.created_at), { addSuffix: true })
            }
          </p>
          
          <button
            onClick={() => router.push(`/map?sos=${sos.id}`)}
            className="w-full mt-2 py-1.5 bg-red-600 text-white text-sm rounded font-medium hover:bg-red-700"
          >
            View Details
          </button>
        </div>
      </Popup>
    </Marker>
  );
}

// =====================================================
// MAIN MAP COMPONENT
// =====================================================
interface IncidentMapProps {
  posts: Post[];
  userLocation: { lat: number; lng: number } | null;
  onPostClick: (postId: string) => void;
  sosAlerts?: SOSAlert[];
  onSOSClick?: (id: string) => void;
}

export default function IncidentMap({ 
  posts, 
  userLocation, 
  onPostClick,
  sosAlerts = [],
  onSOSClick,
}: IncidentMapProps) {
  const router = useRouter();
  
  // Default center (Lagos, Nigeria)
  const defaultCenter: [number, number] = [6.5244, 3.3792];
  const center: [number, number] = userLocation 
    ? [userLocation.lat, userLocation.lng] 
    : defaultCenter;

  const getMarkerIcon = (categoryId: string) => {
    const category = CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return infoIcon;
    
    // Use the color from categories to determine marker
    switch (category.color) {
      case "danger":
        return dangerIcon;      // Red
      case "warning":
        return warningIcon;     // Orange
      case "awareness":
        return awarenessIcon;   // Yellow
      default:
        return infoIcon;        // Blue
    }
  };

  // Get post location
  const getPostLocation = (post: Post, index: number): [number, number] | null => {
    // If we have real location stored, use it
    if (post.location?.latitude && post.location?.longitude) {
      return [post.location.latitude, post.location.longitude];
    }
    
    // Fallback: distribute around user location
    if (userLocation) {
      const offset = 0.01 * (index % 10);
      const angle = (index * 137.5) * (Math.PI / 180);
      return [
        userLocation.lat + offset * Math.cos(angle),
        userLocation.lng + offset * Math.sin(angle),
      ];
    }
    
    // Fallback: random around Lagos
    return [
      defaultCenter[0] + (Math.random() - 0.5) * 0.1,
      defaultCenter[1] + (Math.random() - 0.5) * 0.1,
    ];
  };

  return (
    <MapContainer
      center={center}
      zoom={14}
      style={{ height: "100%", width: "100%" }}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      
      <MapUpdater center={center} />
      
      {/* User location marker */}
      {userLocation && (
        <UserLocationMarker position={[userLocation.lat, userLocation.lng]} />
      )}
      
      {/* Real-time SOS markers */}
      {sosAlerts.map((sos) => (
        <RealtimeSOSMarker key={sos.id} sos={sos} />
      ))}
      
      {/* Incident markers */}
      {posts.map((post, index) => {
        const position = getPostLocation(post, index);
        if (!position) return null;
        
        const category = CATEGORIES.find((c) => c.id === post.category);
        
        return (
          <Marker
            key={post.id}
            position={position}
            icon={getMarkerIcon(post.category)}
            eventHandlers={{
              click: () => onPostClick(post.id),
            }}
          >
            <Popup>
              <div className="min-w-[200px]">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    category?.color === "danger" ? "bg-red-100 text-red-700" :
                    category?.color === "warning" ? "bg-orange-100 text-orange-700" :
                    category?.color === "awareness" ? "bg-yellow-100 text-yellow-700" :
                    "bg-blue-100 text-blue-700"
                  }`}>
                    {category?.name || post.category}
                  </span>
                  {post.status === "live" && (
                    <span className="flex items-center gap-1 text-xs text-red-600">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                      LIVE
                    </span>
                  )}
                </div>
                
                {post.comment && (
                  <p className="text-sm text-gray-700 mb-2 line-clamp-2">
                    {post.comment}
                  </p>
                )}
                
                {post.address && (
                  <p className="text-xs text-gray-500 mb-2">
                    📍 {post.address}
                  </p>
                )}
                
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
                  <span>✓ {post.confirmations} confirmed</span>
                </div>
                
                <button
                  onClick={() => router.push(`/post/${post.id}`)}
                  className="w-full mt-2 py-1.5 bg-purple-600 text-white text-sm rounded font-medium hover:bg-purple-700"
                >
                  View Details
                </button>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}