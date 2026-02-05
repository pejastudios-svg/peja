"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Map, { Marker, NavigationControl, MapRef } from "react-map-gl/maplibre";
import type { MapLibreEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Post, CATEGORIES, SOSAlert, SOS_TAGS } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { useAuth } from "@/context/AuthContext";

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
}

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

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

function getCategoryColor(categoryId: string): string {
  const category = CATEGORIES.find(c => c.id === categoryId);
  switch (category?.color) {
    case "danger": return "#ef4444";
    case "warning": return "#f97316";
    case "awareness": return "#eab308";
    default: return "#3b82f6";
  }
}

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
  const [helpers, setHelpers] = useState<Helper[]>([]);

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
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;

      setTimeout(() => {
        if (modalContentRef.current) {
          modalContentRef.current.scrollTop = 0;
        }
      }, 50);
    } else {
      const scrollY = document.body.style.top;
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      window.scrollTo(0, parseInt(scrollY || '0') * -1);
    }

    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
    };
  }, [selectedSOS]);

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

  // Compass bearing listener - THIS IS THE KEY FEATURE
  useEffect(() => {
    if (!compassEnabled) {
      setBearing(0);
      if (mapRef.current) {
        mapRef.current.easeTo({ bearing: 0, duration: 500 });
      }
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

      const normalizedBearing = ((newBearing % 360) + 360) % 360;
      setBearing(normalizedBearing);

      if (mapRef.current) {
        mapRef.current.easeTo({
          bearing: normalizedBearing,
          duration: 100,
        });
      }
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
        .catch(console.error);
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedSOS?.id]);

  // Listen for helper notifications
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

            setHelpers(prev => {
              if (prev.some(h => h.id === helperData.helper_id)) {
                return prev.map(h =>
                  h.id === helperData.helper_id
                    ? { ...h, lat: helperData.helper_lat, lng: helperData.helper_lng, eta: helperData.eta_minutes }
                    : h
                );
              }

              return [...prev, {
                id: helperData.helper_id,
                name: helperData.helper_name || "Someone",
                avatar_url: helperData.helper_avatar,
                lat: helperData.helper_lat,
                lng: helperData.helper_lng,
                eta: helperData.eta_minutes,
              }];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [myUserId]);

  const handleICanHelp = async (sos: SOSAlert) => {
    if (!user || !userLocation) {
      setToast("Please enable location to help");
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

      await createNotification({
        userId: sos.user_id,
        type: "sos_alert",
        title: "Help is on the way!",
        body: `${userData?.full_name || "Someone"} is coming to help you. ETA: ${eta} minutes`,
        data: {
          sos_id: sos.id,
          helper_id: user.id,
          helper_name: userData?.full_name || "Someone",
          helper_avatar: userData?.avatar_url || null,
          helper_lat: userLocation.lat,
          helper_lng: userLocation.lng,
          eta_minutes: eta
        },
      });

      startHelperLocationTracking(sos.user_id, sos.id, userData?.full_name || "Someone", userData?.avatar_url);

      setToast(`Thank you! ${sos.user?.full_name || "The person"} has been notified. ETA: ${eta} minutes.`);
      setTimeout(() => setToast(null), 3000);
      setSelectedSOS(null);
    } catch (err) {
      console.error("Error:", err);
      setToast("Failed to notify. Please try again.");
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSendingHelp(false);
    }
  };

  const startHelperLocationTracking = (sosOwnerId: string, sosId: string, helperName: string, helperAvatar?: string) => {
    if (!navigator.geolocation) return;

    let lastUpdateTime = 0;

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        if (now - lastUpdateTime < 10000) return;
        lastUpdateTime = now;

        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        const { data: sosData } = await supabase
          .from("sos_alerts")
          .select("latitude, longitude, status")
          .eq("id", sosId)
          .single();

        if (!sosData || sosData.status !== "active") {
          navigator.geolocation.clearWatch(watchId);
          return;
        }

        const eta = calculateETA(lat, lng, sosData.latitude, sosData.longitude);

        await createNotification({
          userId: sosOwnerId,
          type: "sos_alert",
          title: "Helper location update",
          body: `${helperName} is ${eta} minutes away`,
          data: {
            sos_id: sosId,
            helper_id: user?.id,
            helper_name: helperName,
            helper_avatar: helperAvatar || null,
            helper_lat: lat,
            helper_lng: lng,
            eta_minutes: eta,
            is_location_update: true,
          },
        });
      },
      (error) => {
        console.warn("Helper location tracking error:", error);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );

    setTimeout(() => {
      navigator.geolocation.clearWatch(watchId);
    }, 60 * 60 * 1000);
  };

  const handleMove = useCallback((evt: { viewState: ViewState }) => {
    setViewState(evt.viewState);
  }, []);

  const isOwnSOS = selectedSOS && myUserId && selectedSOS.user_id === myUserId;
  const tagInfo = selectedSOS?.tag ? SOS_TAGS.find(t => t.id === selectedSOS.tag) : null;

  return (
    <>
      <Map
        ref={mapRef}
        {...viewState}
        onMove={handleMove}
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
          layers: [
            {
              id: "osm",
              type: "raster",
              source: "osm",
            },
          ],
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

        {/* Helper Markers */}
        {helpers.map(helper => {
          const avatarUrl = helper.avatar_url || "https://ui-avatars.com/api/?name=H&background=22c55e&color=fff";

          return (
            <Marker
              key={helper.id}
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
      </Map>

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

                {!isOwnSOS && (
                  <button
                    onClick={() => handleICanHelp(selectedSOS)}
                    disabled={sendingHelp}
                    className="flex-1 py-3 bg-green-600 text-white rounded-xl font-medium disabled:opacity-50"
                  >
                    {sendingHelp ? "Sending..." : "I Can Help"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}