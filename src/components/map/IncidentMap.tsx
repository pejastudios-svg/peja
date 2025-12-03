"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { Post, CATEGORIES } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";

// Fix for default marker icons in Leaflet with webpack
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

const dangerIcon = createCustomIcon("#ef4444");
const warningIcon = createCustomIcon("#f97316");
const awarenessIcon = createCustomIcon("#eab308");
const infoIcon = createCustomIcon("#3b82f6");

// Component to update map center when user location changes
function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

// Component to show user's current location
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

interface IncidentMapProps {
  posts: Post[];
  userLocation: { lat: number; lng: number } | null;
  onPostClick: (postId: string) => void;
}

export default function IncidentMap({ posts, userLocation, onPostClick }: IncidentMapProps) {
  const router = useRouter();
  
  // Default center (Lagos, Nigeria)
  const defaultCenter: [number, number] = [6.5244, 3.3792];
  const center: [number, number] = userLocation 
    ? [userLocation.lat, userLocation.lng] 
    : defaultCenter;

  const getMarkerIcon = (categoryId: string) => {
    const category = CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return infoIcon;
    
    switch (category.color) {
      case "danger":
        return dangerIcon;
      case "warning":
        return warningIcon;
      case "awareness":
        return awarenessIcon;
      default:
        return infoIcon;
    }
  };

  // Parse location from PostGIS format or use random offset for demo
  const getPostLocation = (post: Post, index: number): [number, number] | null => {
    // If we have a real location stored, use it
    // For now, we'll create positions around the user/default location
    // In production, you'd parse the actual PostGIS location
    
    if (userLocation) {
      // Create a grid of positions around user for demo
      const offset = 0.01 * (index % 10);
      const angle = (index * 137.5) * (Math.PI / 180); // Golden angle for nice distribution
      return [
        userLocation.lat + offset * Math.cos(angle),
        userLocation.lng + offset * Math.sin(angle),
      ];
    }
    
    // Random positions around Lagos for demo
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