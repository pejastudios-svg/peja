"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import MapGL, { Marker, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { User } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface TrackingMapProps {
  latitude: number;
  longitude: number;
  checkinId: string;
  ownerName: string;
  ownerAvatar?: string;
  isOverdue: boolean;
  onLocationUpdate?: (lat: number, lng: number) => void;
}

export default function TrackingMap({
  latitude,
  longitude,
  checkinId,
  ownerName,
  ownerAvatar,
  isOverdue,
  onLocationUpdate,
}: TrackingMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [liveLat, setLiveLat] = useState(latitude);
  const [liveLng, setLiveLng] = useState(longitude);

  const MAP_STYLE = useMemo(
    () =>
      `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`,
    []
  );

  // Update from props
  useEffect(() => {
    setLiveLat(latitude);
    setLiveLng(longitude);
  }, [latitude, longitude]);

  // Realtime subscription for check-in location
  useEffect(() => {
    if (!checkinId) return;

    const channel = supabase
      .channel(`checkin-track-${checkinId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "safety_checkins", filter: `id=eq.${checkinId}` },
        (payload) => {
          const updated = payload.new as any;
          if (updated.latitude && updated.longitude) {
            setLiveLat(updated.latitude);
            setLiveLng(updated.longitude);
            onLocationUpdate?.(updated.latitude, updated.longitude);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [checkinId, onLocationUpdate]);

  // Smoothly pan to new location
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    mapRef.current.easeTo({
      center: [liveLng, liveLat],
      duration: 800,
    });
  }, [liveLat, liveLng, mapLoaded]);

  const ringColor = isOverdue ? "rgba(239, 68, 68, 0.4)" : "rgba(34, 197, 94, 0.3)";
  const borderColor = isOverdue ? "#ef4444" : "#22c55e";

  return (
    <MapGL
      ref={mapRef}
      initialViewState={{
        longitude: liveLng,
        latitude: liveLat,
        zoom: 15,
        bearing: 0,
        pitch: 0,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={MAP_STYLE}
      maxZoom={18}
      minZoom={3}
      onLoad={() => setMapLoaded(true)}
    >
      {mapLoaded && (
        <Marker longitude={liveLng} latitude={liveLat} anchor="center">
          <div className="relative flex items-center justify-center">
            {/* Pulsing ring */}
            <div
              className="absolute animate-ping rounded-full"
              style={{ width: 48, height: 48, background: ringColor }}
            />
            {/* Outer ring */}
            <div
              className="absolute rounded-full"
              style={{ width: 48, height: 48, background: ringColor, border: `2px solid ${borderColor}` }}
            />
            {/* Avatar */}
            <div
              className="relative w-10 h-10 rounded-full overflow-hidden flex items-center justify-center z-10"
              style={{
                border: `3px solid ${borderColor}`,
                background: "#1a1025",
                boxShadow: `0 0 15px ${ringColor}`,
              }}
            >
              {ownerAvatar ? (
                <img src={ownerAvatar} alt={ownerName} className="w-full h-full object-cover" />
              ) : (
                <User className="w-5 h-5 text-primary-400" />
              )}
            </div>
             {/* Name label */}
            <div
              className="absolute top-14 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-md text-xs font-medium"
              style={{
                background: "rgba(0,0,0,0.75)",
                color: isOverdue ? "#f87171" : "#4ade80",
                border: `1px solid ${isOverdue ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
              }}
            >
              {ownerName}
            </div>
          </div>
        </Marker>
      )}
    </MapGL>
  );
}