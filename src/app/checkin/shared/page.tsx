"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import MapGL, { Marker, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ArrowLeft,
  AlertTriangle,
  MapPin,
  User,
  ChevronRight,
  Radio,
} from "lucide-react";

interface SharedUser {
  checkinId: string;
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  status: "active" | "missed";
  nextCheckInAt: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  lastUpdated: string | null;
}

export default function SharedLocationsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [sharedUsers, setSharedUsers] = useState<SharedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapRef = useRef<MapRef>(null);
  const hasFittedRef = useRef(false);

  const MAP_STYLE = useMemo(
    () => `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`,
    []
  );

  const fetchShared = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { data: checkins } = await supabase
        .from("safety_checkins")
        .select("id, user_id, status, next_check_in_at, latitude, longitude, address, location_updated_at")
        .contains("contact_ids", [user.id])
        .in("status", ["active", "missed"]);

      if (!checkins || checkins.length === 0) {
        setSharedUsers([]);
        setLoading(false);
        return;
      }

      const userIds = checkins.map((c: any) => c.user_id);
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, avatar_url, last_latitude, last_longitude")
        .in("id", userIds);

      const userMap: Record<string, any> = {};
      (users || []).forEach((u: any) => { userMap[u.id] = u; });

      const list: SharedUser[] = checkins.map((c: any) => {
        const userData = userMap[c.user_id];
        return {
          checkinId: c.id,
          userId: c.user_id,
          fullName: userData?.full_name || "Unknown",
          avatarUrl: userData?.avatar_url || null,
          status: c.status,
          nextCheckInAt: c.next_check_in_at,
          latitude: c.latitude || userData?.last_latitude || null,
          longitude: c.longitude || userData?.last_longitude || null,
          address: c.address || null,
          lastUpdated: c.location_updated_at,
        };
      });

      setSharedUsers(list);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchShared();
    const iv = setInterval(fetchShared, 15000);
    return () => clearInterval(iv);
  }, [fetchShared]);

  // Realtime updates
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("shared-locations-rt")
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "safety_checkins" },
        (payload) => {
          const updated = payload.new as any;
          if (updated.status === "cancelled") {
            setSharedUsers((prev) => prev.filter((s) => s.checkinId !== updated.id));
            return;
          }
          setSharedUsers((prev) =>
            prev.map((s) =>
              s.checkinId === updated.id
                ? {
                    ...s,
                    status: updated.status,
                    nextCheckInAt: updated.next_check_in_at,
                    latitude: updated.latitude ?? s.latitude,
                    longitude: updated.longitude ?? s.longitude,
                    address: updated.address ?? s.address,
                    lastUpdated: updated.location_updated_at ?? s.lastUpdated,
                  }
                : s
            )
          );
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const usersWithLocation = sharedUsers.filter((s) => s.latitude && s.longitude);

  // Fit all markers on map
  const fitAllMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const withLoc = sharedUsers.filter((s) => s.latitude && s.longitude);
    if (withLoc.length === 0) return;

    if (withLoc.length === 1) {
      map.flyTo({ center: [withLoc[0].longitude!, withLoc[0].latitude!], zoom: 15, duration: 800 });
    } else {
      const lngs = withLoc.map((u) => u.longitude!);
      const lats = withLoc.map((u) => u.latitude!);
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 100, bottom: 100, left: 60, right: 60 }, maxZoom: 15, duration: 800 }
      );
    }
  }, [sharedUsers]);

  // Initial fit once
  useEffect(() => {
    if (!mapLoaded || hasFittedRef.current) return;
    const withLoc = sharedUsers.filter((s) => s.latitude && s.longitude);
    if (withLoc.length === 0) return;
    hasFittedRef.current = true;
    setTimeout(fitAllMarkers, 500);
  }, [mapLoaded, sharedUsers, fitAllMarkers]);

  // Fly to selected user
  useEffect(() => {
    if (!selectedUserId || !mapLoaded || !mapRef.current) return;
    const u = sharedUsers.find((s) => s.userId === selectedUserId);
    if (u?.latitude && u?.longitude) {
      mapRef.current.flyTo({ center: [u.longitude, u.latitude], zoom: 16, duration: 800 });
    }
  }, [selectedUserId, mapLoaded, sharedUsers]);

  const handleViewAll = () => {
    setSelectedUserId(null);
    setTimeout(fitAllMarkers, 100);
  };

  function getTimeLeft(nextCheckIn: string): { text: string; overdue: boolean } {
    const diff = new Date(nextCheckIn).getTime() - Date.now();
    if (diff <= 0) return { text: "Overdue", overdue: true };
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return { text: m > 0 ? `${m}m ${s}s` : `${s}s`, overdue: false };
  }

  // Timer tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // Default center
  const defaultLat = usersWithLocation[0]?.latitude || 6.5244;
  const defaultLng = usersWithLocation[0]?.longitude || 3.3792;

  return (
    <div className="fixed inset-0 bg-dark-950 flex flex-col z-[100]">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-3 px-4 h-14 bg-dark-950/90 backdrop-blur-sm border-b border-white/5 z-10">
        <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-dark-200" />
        </button>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-dark-100">
            {selectedUserId
              ? sharedUsers.find(s => s.userId === selectedUserId)?.fullName || "Location"
              : "Shared Locations"}
          </h1>
          <p className="text-[10px] text-dark-500">{sharedUsers.length} {sharedUsers.length === 1 ? "person" : "people"} sharing</p>
        </div>
        {selectedUserId ? (
          <button
            onClick={handleViewAll}
            className="text-xs text-primary-400 bg-primary-500/10 px-3 py-1.5 rounded-lg border border-primary-500/20"
          >
            View All
          </button>
        ) : (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[10px] text-green-400 font-medium">LIVE</span>
          </div>
        )}
      </header>

      {/* Map */}
      <div className="flex-1 relative" style={{ minHeight: "55vh" }}>
        {loading ? (
          <div className="w-full h-full bg-dark-900 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <MapGL
            ref={mapRef}
            initialViewState={{
              latitude: defaultLat,
              longitude: defaultLng,
              zoom: 14,
              bearing: 0,
              pitch: 0,
            }}
            style={{ width: "100%", height: "100%" }}
            mapStyle={MAP_STYLE}
            maxZoom={18}
            minZoom={3}
            onLoad={() => setMapLoaded(true)}
          >
            {mapLoaded && usersWithLocation.map((u) => {
              const { overdue } = getTimeLeft(u.nextCheckInAt);
              const isSelected = selectedUserId === u.userId;
              const dimmed = selectedUserId && !isSelected;
              const ringColor = overdue ? "rgba(239, 68, 68, 0.4)" : "rgba(34, 197, 94, 0.3)";
              const borderColor = overdue ? "#ef4444" : "#22c55e";

              return (
                <Marker
                  key={u.userId}
                  latitude={u.latitude!}
                  longitude={u.longitude!}
                  anchor="center"
                  onClick={(e) => {
                    e.originalEvent.stopPropagation();
                    setSelectedUserId(isSelected ? null : u.userId);
                  }}
                >
                  <div
                    className="relative flex flex-col items-center cursor-pointer transition-opacity duration-300"
                    style={{ opacity: dimmed ? 0.35 : 1 }}
                  >
                    {/* Pulsing ring */}
                    {!dimmed && (
                      <div
                        className="absolute animate-ping rounded-full"
                        style={{ width: 48, height: 48, background: ringColor, top: -4, left: -4 }}
                      />
                    )}
                    {/* Outer ring */}
                    <div
                      className="absolute rounded-full"
                      style={{ width: 48, height: 48, background: ringColor, border: `2px solid ${borderColor}`, top: -4, left: -4 }}
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
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} alt={u.fullName} className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-5 h-5 text-primary-400" />
                      )}
                    </div>
                    {/* Overdue badge */}
                    {overdue && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center border-2 border-dark-950 z-20">
                        <AlertTriangle className="w-2 h-2 text-white" />
                      </div>
                    )}
                    {/* Name label */}
                    <div
                      className="absolute whitespace-nowrap px-2 py-0.5 rounded-md text-[10px] font-bold z-20"
                      style={{
                        top: 50,
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: overdue ? "rgba(239,68,68,0.85)" : "rgba(34,197,94,0.85)",
                        color: "white",
                        boxShadow: `0 2px 8px ${overdue ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
                      }}
                    >
                      {u.fullName.split(" ")[0]}
                    </div>
                  </div>
                </Marker>
              );
            })}
          </MapGL>
        )}
      </div>

      {/* User list */}
      <div className="shrink-0 max-h-[35vh] overflow-y-auto bg-dark-950 border-t border-white/5">
        <div className="p-3 space-y-1.5">
          {sharedUsers.length === 0 && !loading && (
            <div className="text-center py-6">
              <MapPin className="w-8 h-8 text-dark-600 mx-auto mb-2" />
              <p className="text-sm text-dark-400">No one is sharing their location with you</p>
            </div>
          )}
          {sharedUsers.map((u) => {
            const { text, overdue } = getTimeLeft(u.nextCheckInAt);
            const isSelected = selectedUserId === u.userId;

            return (
              <button
                key={u.userId}
                onClick={() => {
                  if (isSelected) {
                    router.push(`/checkin/track/${u.checkinId}`);
                  } else {
                    setSelectedUserId(u.userId);
                  }
                }}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-all ${
                  isSelected
                    ? "bg-primary-600/10 border border-primary-500/30"
                    : "bg-white/[0.03] border border-transparent hover:bg-white/[0.06]"
                }`}
              >
                <div className="relative shrink-0">
                  <div
                    className="w-10 h-10 rounded-full overflow-hidden"
                    style={{
                      border: `2.5px solid ${overdue ? "#ef4444" : "#22c55e"}`,
                      boxShadow: `0 0 8px ${overdue ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
                    }}
                  >
                    {u.avatarUrl ? (
                      <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-dark-700 flex items-center justify-center">
                        <User className="w-4 h-4 text-dark-400" />
                      </div>
                    )}
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center border-2 border-dark-950 ${overdue ? "bg-red-500" : "bg-green-500"}`}>
                    {overdue ? <AlertTriangle className="w-1.5 h-1.5 text-white" /> : <Radio className="w-1.5 h-1.5 text-white" />}
                  </div>
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-white truncate">{u.fullName}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin className="w-2.5 h-2.5 text-dark-500 shrink-0" />
                    <p className="text-[10px] text-dark-400 truncate">
                      {u.address || (u.latitude && u.longitude ? `${u.latitude.toFixed(4)}, ${u.longitude.toFixed(4)}` : "Updating...")}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-xs font-bold ${overdue ? "text-red-400" : "text-green-400"}`}>{text}</p>
                  <p className="text-[9px] text-dark-500">{overdue ? "OVERDUE" : "check-in"}</p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-dark-500 shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
