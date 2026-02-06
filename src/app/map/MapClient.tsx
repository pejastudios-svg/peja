"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES, SOSAlert } from "@/lib/types";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/Badge";
import { Loader2, Navigation, List, Map as MapIcon, AlertTriangle, BarChart3, Compass } from "lucide-react";
import { subHours } from "date-fns";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFeedCache } from "@/context/FeedContext";
import DataAnalyticsPanel from "@/components/map/DataAnalyticsPanel";

const IncidentMap = dynamic(() => import("@/components/map/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-dark-800">
      <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
    </div>
  ),
});

type SOSUserPublic = { full_name: string; avatar_url?: string };

export default function MapClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sosIdFromUrl = searchParams.get("sos");
  const latFromUrl = searchParams.get("lat");
  const lngFromUrl = searchParams.get("lng");
  const handledSosParamRef = useRef(false);

  const sosUserCacheRef = useRef<Record<string, SOSUserPublic>>({});

  const feedCache = useFeedCache();

  const [posts, setPosts] = useState<Post[]>(() => {
    if (typeof window !== "undefined") return feedCache.get("map:posts")?.posts || [];
    return [];
  });

  const [sosAlerts, setSOSAlerts] = useState<SOSAlert[]>(() => {
    if (typeof window !== "undefined") return feedCache.get("map:sos")?.posts as unknown as SOSAlert[] || [];
    return [];
  });

  const [loading, setLoading] = useState(() => posts.length === 0);

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showList, setShowList] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const [shouldCenterOnUser, setShouldCenterOnUser] = useState(false);
  const [centerOnSOS, setCenterOnSOS] = useState<{ lat: number; lng: number } | null>(null);
  const [openSOSId, setOpenSOSId] = useState<string | null>(null);
  const [compassEnabled, setCompassEnabled] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Real-time location watching
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    router.prefetch("/map");
    router.prefetch("/notifications");
    router.prefetch("/profile");
  }, [router]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setMyUserId(data.user?.id || null);
    });
  }, []);

  // Listen for real-time location updates
useEffect(() => {
  const handleLocationUpdate = (e: CustomEvent) => {
    setUserLocation({
      lat: e.detail.lat,
      lng: e.detail.lng
    });
  };

  window.addEventListener('peja-user-location-update', handleLocationUpdate as EventListener);
  
  return () => {
    window.removeEventListener('peja-user-location-update', handleLocationUpdate as EventListener);
  };
}, []);

  // Start watching location for real-time updates
  useEffect(() => {
    if (!navigator.geolocation) return;

    const updateLocation = (position: GeolocationPosition) => {
      const newLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      setUserLocation(newLocation);
    };

    const handleError = (error: GeolocationPositionError) => {
      console.warn("Location watch error:", error.message);
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      updateLocation,
      handleError,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const getUserLocation = useCallback(() => {
    setGettingLocation(true);

    if (!navigator.geolocation) {
      setGettingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const newLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setUserLocation(newLocation);
        setGettingLocation(false);

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from("users")
            .update({
              last_latitude: newLocation.lat,
              last_longitude: newLocation.lng,
              last_location_updated_at: new Date().toISOString(),
            })
            .eq("id", user.id);
        }
      },
      (error) => {
        console.warn("Location error:", error.message);
        setGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  }, []);

  const requestCompassPermission = async () => {
    try {
      const DOE: any = DeviceOrientationEvent;
      if (typeof DOE?.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res === "granted") {
          setCompassEnabled(true);
        }
      } else {
        setCompassEnabled(true);
      }
    } catch (e) {
      console.warn("Compass permission denied:", e);
    }
  };

  const handleCenterOnUser = useCallback(() => {
    getUserLocation();
    setShouldCenterOnUser(true);
    setTimeout(() => setShouldCenterOnUser(false), 800);
  }, [getUserLocation]);

  const handleSOSClick = useCallback((sos: SOSAlert) => {
    setCenterOnSOS({ lat: sos.latitude, lng: sos.longitude });
    setOpenSOSId(sos.id);
    setShowList(false);
    setTimeout(() => setCenterOnSOS(null), 800);
  }, []);

  const handleAnalyticsAreaSelect = useCallback((lat: number, lng: number) => {
    setCenterOnSOS({ lat, lng });
    setTimeout(() => setCenterOnSOS(null), 800);
  }, []);

  const fetchPosts = useCallback(async () => {
    try {
      const twentyFourHoursAgo = subHours(new Date(), 24).toISOString();

      const { data, error } = await supabase
        .from("posts")
        .select(`
          id, user_id, category, comment, address,
          latitude, longitude,
          is_anonymous, status, is_sensitive,
          confirmations, views, comment_count, report_count, created_at,
          post_media (id, post_id, url, media_type, is_sensitive)
        `)
        .eq("status", "live")
        .gte("created_at", twentyFourHoursAgo)
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const formatted: Post[] = (data || [])
        .filter((p: any) => p.latitude && p.longitude)
        .map((p: any) => ({
          id: p.id,
          user_id: p.user_id,
          category: p.category,
          comment: p.comment,
          location: { latitude: p.latitude, longitude: p.longitude },
          address: p.address,
          is_anonymous: p.is_anonymous,
          status: p.status,
          is_sensitive: p.is_sensitive,
          confirmations: p.confirmations || 0,
          views: p.views || 0,
          comment_count: p.comment_count || 0,
          report_count: p.report_count || 0,
          created_at: p.created_at,
          media: (p.post_media || []).map((m: any) => ({
            id: m.id,
            post_id: m.post_id,
            url: m.url,
            media_type: m.media_type as "photo" | "video",
            is_sensitive: m.is_sensitive,
          })),
          tags: [],
        }));

      setPosts(formatted);
      feedCache.setPosts("map:posts", formatted);
    } catch (e) {
      console.error("Error fetching posts:", e);
    } finally {
      setLoading(false);
    }
  }, [feedCache]);

  const fetchSOSAlerts = useCallback(async () => {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: sosData, error: sosError } = await supabase
        .from("sos_alerts")
        .select(`
          id, user_id, latitude, longitude, address, status, tag, message,
          bearing, created_at, last_updated, resolved_at
        `)
        .eq("status", "active")
        .gte("created_at", twentyFourHoursAgo)
        .order("created_at", { ascending: false })
        .limit(200);

      if (sosError) {
        console.error("SOS query error:", sosError);
        return;
      }

      const userIds = Array.from(new Set((sosData || []).map((s: any) => s.user_id).filter(Boolean)));

      if (userIds.length > 0) {
        const { data: usersData } = await supabase
          .from("users")
          .select("id, full_name, avatar_url")
          .in("id", userIds);

        if (usersData) {
          for (const u of usersData) {
            sosUserCacheRef.current[u.id] = {
              full_name: u.full_name || "Someone",
              avatar_url: u.avatar_url || undefined,
            };
          }
        }
      }

      const formatted: SOSAlert[] = (sosData || []).map((s: any) => ({
        id: s.id,
        user_id: s.user_id,
        latitude: s.latitude,
        longitude: s.longitude,
        address: s.address,
        status: s.status,
        tag: s.tag,
        message: s.message,
        bearing: s.bearing,
        created_at: s.created_at,
        last_updated: s.last_updated,
        resolved_at: s.resolved_at,
        user: sosUserCacheRef.current[s.user_id] || undefined,
      }));

      setSOSAlerts(formatted);
      feedCache.setPosts("map:sos", formatted as any[]);

      if (sosIdFromUrl && !handledSosParamRef.current) {
        const match = formatted.find((x) => x.id === sosIdFromUrl);

        if (match) {
          setCenterOnSOS({ lat: match.latitude, lng: match.longitude });
          setOpenSOSId(match.id);
          handledSosParamRef.current = true;
        } else {
          const lat = latFromUrl ? Number(latFromUrl) : NaN;
          const lng = lngFromUrl ? Number(lngFromUrl) : NaN;

          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            setCenterOnSOS({ lat, lng });
            setOpenSOSId(sosIdFromUrl);
            handledSosParamRef.current = true;
          }
        }
      }
    } catch (e) {
      console.error("SOS fetch failed:", e);
    }
  }, [sosIdFromUrl, latFromUrl, lngFromUrl, feedCache]);

  useEffect(() => {
    const timer = setTimeout(() => setMapReady(true), 100);

    getUserLocation();
    fetchPosts();
    fetchSOSAlerts();

    const sosChannel = supabase
      .channel("sos-map")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, (payload) => {
        const newRow: any = payload.new;
        const oldRow: any = payload.old;
        if (myUserId && newRow?.user_id === myUserId) return;
        
        if (payload.eventType === "INSERT") {
          if (newRow?.status === "active") {
            setSOSAlerts((prev) => {
              if (prev.some((s) => s.id === newRow.id)) return prev;

              return [
                {
                  id: newRow.id,
                  user_id: newRow.user_id,
                  latitude: newRow.latitude,
                  longitude: newRow.longitude,
                  address: newRow.address,
                  status: newRow.status,
                  tag: newRow.tag,
                  message: newRow.message,
                  bearing: newRow.bearing,
                  created_at: newRow.created_at,
                  last_updated: newRow.last_updated,
                  resolved_at: newRow.resolved_at,
                  user: sosUserCacheRef.current[newRow.user_id] || undefined,
                },
                ...prev,
              ];
            });

            if (!sosUserCacheRef.current[newRow.user_id]) {
              (async () => {
                const { data } = await supabase
                  .from("users")
                  .select("id, full_name, avatar_url")
                  .eq("id", newRow.user_id)
                  .maybeSingle();

                if (data) {
                  sosUserCacheRef.current[data.id] = {
                    full_name: data.full_name || "Someone",
                    avatar_url: data.avatar_url || undefined,
                  };

                  setSOSAlerts((prev) =>
                    prev.map((s) =>
                      s.id === newRow.id ? { ...s, user: sosUserCacheRef.current[data.id] } : s
                    )
                  );
                }
              })();
            }
          }
          return;
        }

        if (payload.eventType === "UPDATE") {
          if (newRow?.status && newRow.status !== "active") {
            setSOSAlerts((prev) => prev.filter((s) => s.id !== newRow.id));
            return;
          }

          setSOSAlerts((prev) =>
            prev.map((s) =>
              s.id === newRow.id
                ? {
                    ...s,
                    latitude: newRow.latitude ?? s.latitude,
                    longitude: newRow.longitude ?? s.longitude,
                    address: newRow.address ?? s.address,
                    tag: newRow.tag ?? s.tag,
                    message: newRow.message ?? s.message,
                    bearing: newRow.bearing ?? s.bearing,
                    last_updated: newRow.last_updated ?? s.last_updated,
                  }
                : s
            )
          );
          return;
        }

        if (payload.eventType === "DELETE") {
          setSOSAlerts((prev) => prev.filter((s) => s.id !== oldRow?.id));
        }
      })
      .subscribe();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(sosChannel);
    };
  }, [fetchPosts, fetchSOSAlerts, getUserLocation, myUserId]);

  const handlePostClick = (postId: string) => router.push(`/post/${postId}`);

  const filteredPosts = selectedCategory ? posts.filter((p) => p.category === selectedCategory) : posts;

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header variant="back" title="Map" onBack={() => router.back()} onCreateClick={() => router.push("/create")} />

            <main className="pt-16 h-screen">
        <div className="relative h-[calc(100vh-8rem)] lg:h-[calc(100vh-4rem)]">
          {loading || !mapReady ? (
            <div className="h-full bg-dark-800 flex items-center justify-center">
              <Skeleton className="h-[70vh] w-[92vw] max-w-5xl rounded-2xl" />
            </div>
          ) : (
            <IncidentMap
              posts={filteredPosts}
              userLocation={userLocation}
              onPostClick={handlePostClick}
              sosAlerts={sosAlerts}
              centerOnUser={shouldCenterOnUser}
              centerOnCoords={centerOnSOS}
              openSOSId={openSOSId}
              compassEnabled={compassEnabled}
              myUserId={myUserId}
            />
          )}

          {sosAlerts.length > 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-1000">
              <div className="glass-float rounded-xl px-4 py-2.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
                </div>
                <span className="text-sm font-semibold text-red-400 whitespace-nowrap">
                  {sosAlerts.length} Active SOS
                </span>
              </div>
            </div>
          )}

          <div className="absolute top-16 left-4 right-4 z-1000">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap shadow-lg ${
                  !selectedCategory ? "bg-primary-600 text-white" : "glass-float text-dark-200"
                }`}
              >
                All ({posts.length})
              </button>
            </div>
          </div>

          {/* Compass toggle button */}
          <button
            onClick={async () => {
              if (!compassEnabled) {
                await requestCompassPermission();
              } else {
                setCompassEnabled(false);
              }
            }}
            className={`absolute bottom-36 right-4 z-1000 p-3 rounded-full shadow-lg transition-all ${
              compassEnabled 
                ? "bg-primary-600 text-white" 
                : "glass-float text-primary-400 hover:bg-white/10"
            }`}
          >
            <Compass className="w-5 h-5" />
          </button>

          {/* Center on user button */}
          <button
            onClick={() => {
              handleCenterOnUser();
            }}
            disabled={gettingLocation}
            className="absolute bottom-24 right-4 z-1000 p-3 glass-float rounded-full shadow-lg hover:bg-white/10"
          >
            {gettingLocation ? (
              <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
            ) : (
              <Navigation className="w-5 h-5 text-primary-400" />
            )}
          </button>

          {/* Analytics toggle button */}
          <button
            onClick={() => setShowAnalytics(true)}
            className="absolute bottom-36 left-4 z-1000 p-3 glass-float rounded-full shadow-lg hover:bg-white/10"
          >
            <BarChart3 className="w-5 h-5 text-primary-400" />
          </button>

          {/* List toggle button */}
          <button
            onClick={() => setShowList(!showList)}
            className="absolute bottom-24 left-4 z-1000 p-3 glass-float rounded-full shadow-lg"
          >
            {showList ? <MapIcon className="w-5 h-5 text-primary-400" /> : <List className="w-5 h-5 text-primary-400" />}
          </button>

          {/* Bottom drawer */}
          <div
            className={`absolute bottom-0 left-0 right-0 z-2000 glass-strong rounded-t-2xl shadow-2xl transition-transform duration-300 ${
              showList ? "translate-y-0" : "translate-y-[calc(100%-60px)]"
            }`}
            style={{ maxHeight: "60%" }}
          >
            <button onClick={() => setShowList(!showList)} className="w-full py-3 flex flex-col items-center">
              <div className="w-10 h-1 bg-dark-600 rounded-full mb-1" />
              <span className="text-sm text-dark-400">{filteredPosts.length} incidents</span>
            </button>

            <div className="overflow-y-auto px-4 pb-4" style={{ maxHeight: "calc(60vh - 60px)" }}>
              {/* SOS Alerts */}
              {sosAlerts.map((sos) => (
                <div
                  key={sos.id}
                  onClick={() => handleSOSClick(sos)}
                  className="flex gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl mb-2 cursor-pointer hover:bg-red-500/20 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center overflow-hidden">
                    {sos.user?.avatar_url ? (
                      <img src={sos.user.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-red-400 wrap-break-word">
                      {sos.user?.full_name || "Someone"} needs help!
                    </p>
                    <p className="text-xs text-dark-400 wrap-break-word">{sos.address}</p>
                  </div>
                  <div className="text-xs text-dark-500">Tap to view</div>
                </div>
              ))}

              {/* Posts */}
              {filteredPosts.map((post) => {
                const category = CATEGORIES.find((c) => c.id === post.category);
                return (
                  <div
                    key={post.id}
                    onClick={() => router.push(`/post/${post.id}`)}
                    className="flex gap-3 p-3 glass-sm rounded-xl mb-2 cursor-pointer hover:bg-white/5"
                  >
                    {post.media?.[0] && (
                      <img src={post.media[0].url} alt="" className="w-16 h-16 rounded-lg object-cover" />
                    )}
                    <div className="flex-1 min-w-0">
                      <Badge variant={category?.color === "danger" ? "danger" : "info"}>
                        {category?.name || post.category}
                      </Badge>
                      {post.comment && (
                        <p className="text-sm text-dark-200 line-clamp-1 mt-1 wrap-break-word">
                          {post.comment}
                        </p>
                      )}
                      <p className="text-xs text-dark-500 mt-1 wrap-break-word">{post.address}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Map Legend */}
          <div className="absolute top-32 right-4 z-1000 glass-float rounded-lg p-3 text-xs space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500 rounded-full" />
              <span className="text-dark-200">Danger</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-orange-500 rounded-full" />
              <span className="text-dark-200">Caution</span>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-white/10">
              <span className="w-3 h-3 bg-primary-500 rounded-full" />
              <span className="text-dark-200">You</span>
            </div>
            {compassEnabled && (
              <div className="flex items-center gap-2 pt-1 border-t border-white/10">
                <Compass className="w-3 h-3 text-primary-400" />
                <span className="text-primary-400">Direction Active</span>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Data Analytics Panel */}
      <DataAnalyticsPanel
        isOpen={showAnalytics}
        onClose={() => setShowAnalytics(false)}
        onSelectArea={handleAnalyticsAreaSelect}
      />
    </div>
  );
}