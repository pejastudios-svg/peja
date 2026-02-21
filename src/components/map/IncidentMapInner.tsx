"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import L from "leaflet";
import { Post, CATEGORIES, SOSAlert, SOS_TAGS } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { useAuth } from "@/context/AuthContext";

if (typeof window !== "undefined") {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

interface IncidentMapInnerProps {
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

const createUserLocationIcon = (bearing: number, compassEnabled: boolean) => {
  // Only show arrow rotation when compass is enabled
  const arrowRotation = compassEnabled ? bearing : 0;
  const showArrow = compassEnabled;
  
  return L.divIcon({
    className: "user-location-marker",
    html: `
      <div style="position: relative; width: 48px; height: 48px;">
        ${showArrow ? `
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          transform: rotate(${arrowRotation}deg);
          transition: transform 0.3s ease-out;
        ">
          <div style="
            position: absolute;
            top: 2px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-bottom: 12px solid #7c3aed;
            z-index: 3;
          "></div>
        </div>
        ` : ''}
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

// FIXED: SOS icon with arrow attached and red glow (not fade)
const createSOSIcon = (avatarUrl?: string, bearing = 0) => {
  const img = avatarUrl || "https://ui-avatars.com/api/?name=SOS&background=dc2626&color=fff";
  return L.divIcon({
    className: "sos-marker",
    html: `
      <div class="sos-marker-wrapper" style="position: relative; width: 56px; height: 56px;">
        <!-- Glow ring -->
        <div class="sos-glow-ring"></div>
        
        <!-- Arrow attached to circle -->
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
            top: 2px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-bottom: 12px solid #dc2626;
            z-index: 3;
          "></div>
        </div>
        
        <!-- Profile circle -->
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 40px;
          height: 40px;
          border-radius: 50%;
          overflow: hidden;
          border: 3px solid #dc2626;
          background: white;
          z-index: 2;
        ">
          <img src="${img}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://ui-avatars.com/api/?name=SOS&background=dc2626&color=fff'" />
        </div>
      </div>
    `,
    iconSize: [56, 56],
    iconAnchor: [28, 28],
    popupAnchor: [0, -28],
  });
};

// Helper icon (green border)
const createHelperIcon = (avatarUrl?: string) => {
  const img = avatarUrl || "https://ui-avatars.com/api/?name=H&background=22c55e&color=fff";
  return L.divIcon({
    className: "helper-marker",
    html: `
      <div style="position: relative; width: 48px; height: 48px;">
        <div class="helper-glow-ring"></div>
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          overflow: hidden;
          border: 3px solid #22c55e;
          background: white;
          z-index: 2;
        ">
          <img src="${img}" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -24],
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

interface Helper {
  id: string;
  name: string;
  avatar_url?: string;
  lat: number;
  lng: number;
  eta: number;
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
  compassEnabled = false,
  myUserId = null,
}: IncidentMapInnerProps) {
  const { user } = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const autoOpenedRef = useRef(false);
  const sosMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const helperMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const modalContentRef = useRef<HTMLDivElement>(null);
  
  const [selectedSOS, setSelectedSOS] = useState<SOSAlert | null>(null);
  const [sendingHelp, setSendingHelp] = useState(false);
  const [liveSOSAlerts, setLiveSOSAlerts] = useState<SOSAlert[]>(sosAlerts);
  const [bearing, setBearing] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [helpers, setHelpers] = useState<Helper[]>([]);

  const defaultCenter: [number, number] = [6.5244, 3.3792];
  const center = useMemo(() => 
    userLocation ? [userLocation.lat, userLocation.lng] as [number, number] : defaultCenter,
    [userLocation]
  );

  // Lock body scroll when modal is open
  useEffect(() => {
    if (selectedSOS) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${window.scrollY}px`;
      
      // Scroll modal content to top
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

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: center,
      zoom: 14,
      zoomControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Auto-open SOS from URL
  useEffect(() => {
    if (!openSOSId) return;
    if (autoOpenedRef.current) return;

    const match = liveSOSAlerts.find(s => s.id === openSOSId);
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

  // Center on coords when requested
  useEffect(() => {
    if (!centerOnCoords || !mapInstanceRef.current) return;
    mapInstanceRef.current.setView([centerOnCoords.lat, centerOnCoords.lng], 16, { animate: true });
  }, [centerOnCoords]);

  // Real-time smooth user location update
  useEffect(() => {
    if (!mapInstanceRef.current || !userLocation) return;

    const targetLat = userLocation.lat;
    const targetLng = userLocation.lng;

    if (userMarkerRef.current) {
      const currentLatLng = userMarkerRef.current.getLatLng();
      const startLat = currentLatLng.lat;
      const startLng = currentLatLng.lng;
      
      let startTime: number | null = null;
      const duration = 500;
      
      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        
        const newLat = startLat + (targetLat - startLat) * easeOut;
        const newLng = startLng + (targetLng - startLng) * easeOut;
        
        userMarkerRef.current?.setLatLng([newLat, newLng]);
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      
      requestAnimationFrame(animate);
            userMarkerRef.current.setIcon(createUserLocationIcon(bearing, compassEnabled));
    } else {
            userMarkerRef.current = L.marker([targetLat, targetLng], {
        icon: createUserLocationIcon(bearing, compassEnabled),
      }).addTo(mapInstanceRef.current);
      
      userMarkerRef.current.bindPopup("<div class='text-center p-1'><p class='font-medium text-gray-800'>You are here</p></div>");
    }
  }, [userLocation, bearing]);

  // Update post markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

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

  // Update SOS markers with smooth animation
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    liveSOSAlerts.forEach(sos => {
      const existingMarker = sosMarkersRef.current.get(sos.id);
      
      if (existingMarker) {
        const currentLatLng = existingMarker.getLatLng();
        const targetLat = sos.latitude;
        const targetLng = sos.longitude;
        
        let startTime: number | null = null;
        const duration = 500;
        
        const animate = (timestamp: number) => {
          if (!startTime) startTime = timestamp;
          const progress = Math.min((timestamp - startTime) / duration, 1);
          const easeOut = 1 - Math.pow(1 - progress, 3);
          
          const newLat = currentLatLng.lat + (targetLat - currentLatLng.lat) * easeOut;
          const newLng = currentLatLng.lng + (targetLng - currentLatLng.lng) * easeOut;
          
          existingMarker.setLatLng([newLat, newLng]);
          
          if (progress < 1) {
            requestAnimationFrame(animate);
          }
        };
        
        requestAnimationFrame(animate);
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

    sosMarkersRef.current.forEach((marker, id) => {
      if (!liveSOSAlerts.find(s => s.id === id)) {
        marker.remove();
        sosMarkersRef.current.delete(id);
      }
    });
  }, [liveSOSAlerts]);

  // Update helper markers on map
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    helpers.forEach(helper => {
      const existingMarker = helperMarkersRef.current.get(helper.id);
      
      if (existingMarker) {
        // Smooth update position
        const currentLatLng = existingMarker.getLatLng();
        let startTime: number | null = null;
        const duration = 500;
        
        const animate = (timestamp: number) => {
          if (!startTime) startTime = timestamp;
          const progress = Math.min((timestamp - startTime) / duration, 1);
          const easeOut = 1 - Math.pow(1 - progress, 3);
          
          const newLat = currentLatLng.lat + (helper.lat - currentLatLng.lat) * easeOut;
          const newLng = currentLatLng.lng + (helper.lng - currentLatLng.lng) * easeOut;
          
          existingMarker.setLatLng([newLat, newLng]);
          
          if (progress < 1) {
            requestAnimationFrame(animate);
          }
        };
        
        requestAnimationFrame(animate);
      } else {
        const marker = L.marker([helper.lat, helper.lng], {
          icon: createHelperIcon(helper.avatar_url),
        }).addTo(mapInstanceRef.current!);
        
        marker.bindPopup(`
          <div class="text-center p-2">
            <p class="font-medium text-gray-800">${helper.name}</p>
            <p class="text-xs text-green-600">Coming to help • ETA: ${helper.eta} min</p>
          </div>
        `);
        
        helperMarkersRef.current.set(helper.id, marker);
      }
    });

    helperMarkersRef.current.forEach((marker, id) => {
      if (!helpers.find(h => h.id === id)) {
        marker.remove();
        helperMarkersRef.current.delete(id);
      }
    });
  }, [helpers]);

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

  // Listen for helper notifications (for SOS owner to see incoming helpers)
  useEffect(() => {
    if (!myUserId) return;

    const channel = supabase
      .channel("sos-helpers-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${myUserId}` },
        async (payload) => {
          const notification: any = payload.new;
          
          // Check if it's a help notification
          if (notification?.type === "sos_alert" && notification?.data?.helper_id) {
            const helperData = notification.data;
            
            // Add helper to the list
            setHelpers(prev => {
              // Don't add duplicates
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

  // Compass bearing listener
  useEffect(() => {
    if (!compassEnabled) return;
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
  }, [compassEnabled]);

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
      
      // Send notification with helper's location data
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

      // Start tracking helper's location and send updates
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

  // Track helper location and send updates to SOS owner
  const startHelperLocationTracking = (sosOwnerId: string, sosId: string, helperName: string, helperAvatar?: string) => {
    if (!navigator.geolocation) return;

    let lastUpdateTime = 0;
    
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        // Throttle updates to every 10 seconds
        if (now - lastUpdateTime < 10000) return;
        lastUpdateTime = now;

        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        // Calculate new ETA
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

        // Send location update notification
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

    // Stop tracking after 1 hour
    setTimeout(() => {
      navigator.geolocation.clearWatch(watchId);
    }, 60 * 60 * 1000);
  };

  const isOwnSOS = selectedSOS && myUserId && selectedSOS.user_id === myUserId;
  const tagInfo = selectedSOS?.tag ? SOS_TAGS.find(t => t.id === selectedSOS.tag) : null;

  return (
    <>
      <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[3000] glass-float px-4 py-2 rounded-xl text-dark-100">
          {toast}
        </div>
      )}

      {/* SOS Details Modal */}
      {selectedSOS && (
        <div className="fixed inset-0 z-[5000] flex items-start justify-center overflow-hidden">
          <div className="absolute inset-0 bg-black/80" onClick={() => setSelectedSOS(null)} />
          <div 
            ref={modalContentRef}
            className="relative glass-strong w-full h-full max-w-lg overflow-hidden flex flex-col"
          >
            {/* User Info Header - Always at top */}
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
              
              {/* User Profile - At top of modal */}
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

              {/* Emergency Call Buttons - Always show */}
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
                
                {/* Only show "I Can Help" if NOT own SOS */}
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