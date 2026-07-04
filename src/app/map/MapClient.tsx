"use client";

import { useState, useEffect, useCallback, useRef, Component, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES, SOSAlert } from "@/lib/types";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/Badge";
import { Loader2, Navigation, Map as MapIcon, AlertTriangle, BarChart3, Compass, MapPin } from "lucide-react";
import { subHours } from "date-fns";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFeedCache } from "@/context/FeedContext";
import { realtimeManager } from "@/lib/realtime";
import { usePageCache } from "@/context/PageCacheContext";
import DataAnalyticsPanel from "@/components/map/DataAnalyticsPanel";
import { ChevronDown } from "lucide-react";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { isNigeriaPost } from "@/lib/notifications";
import { AvatarImage } from "@/components/ui/AvatarImage";

const IncidentMap = dynamic(() => import("@/components/map/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-dark-800">
      <PejaSpinner className="w-8 h-8" />
    </div>
  ),
});

// Catches errors from the dynamic IncidentMap import (e.g. the MapLibre
// chunk wasn't pre-cached and we're offline) so they don't escalate to
// the segment-level error.tsx and replace the whole page with
// "Something went wrong". The rest of the map page (header, controls)
// still renders; only the map canvas shows the offline message.
class IncidentMapBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    if (this.state.failed) {
      return (
        <div className="h-full flex items-center justify-center bg-dark-800 px-6">
          <div className="text-center max-w-xs">
            <div className="w-12 h-12 rounded-full bg-primary-500/15 flex items-center justify-center mx-auto mb-3">
              <MapIcon className="w-6 h-6 text-primary-300" />
            </div>
            <p className="text-sm font-medium text-dark-100 mb-1">
              Map unavailable offline
            </p>
            <p className="text-xs text-dark-400">
              Connect to the internet to load the map. Posts and alerts will sync when you&apos;re back online.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type SOSUserPublic = { full_name: string; avatar_url?: string };

export default function MapClient() {
  // ============================================================
  // ALL HOOKS — no early returns above this section
  // ============================================================

  const router = useRouter();
  const searchParams = useSearchParams();

  const sosIdFromUrl = searchParams.get("sos");
  const postIdFromUrl = searchParams.get("post");
  const latFromUrl = searchParams.get("lat");
  const lngFromUrl = searchParams.get("lng");
  const handledSosParamRef = useRef(false);
  const handledPostParamRef = useRef<string | null>(null);
  const [previewPostId, setPreviewPostId] = useState<string | null>(null);

  const sosUserCacheRef = useRef<Record<string, SOSUserPublic>>({});

  const feedCache = useFeedCache();
  const pageCache = usePageCache();

  // --- INSTANT CACHE INITIALIZATION ---
  const [posts, setPosts] = useState<Post[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get("map:posts");
      if (cached?.posts?.length) return cached.posts;
    }
    return [];
  });

  const [sosAlerts, setSOSAlerts] = useState<SOSAlert[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get("map:sos");
      if (cached?.posts) return cached.posts as unknown as SOSAlert[];
    }
    return [];
  });

  const [loading, setLoading] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get("map:posts");
      if (cached?.posts?.length) return false;
    }
    return true;
  });

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(() => {
    if (typeof window !== "undefined") {
      const cached = pageCache.get<{ lat: number; lng: number }>("map:userLocation");
      if (cached) return cached;
    }
    return null;
  });

  const [showList, setShowList] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

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
      const loc = { lat: e.detail.lat, lng: e.detail.lng };
      setUserLocation(loc);
      pageCache.set("map:userLocation", loc);
    };

    window.addEventListener("peja-user-location-update", handleLocationUpdate as EventListener);

    return () => {
      window.removeEventListener("peja-user-location-update", handleLocationUpdate as EventListener);
    };
  }, [pageCache]);

  // Start watching location for real-time updates
  useEffect(() => {
    if (!navigator.geolocation) return;

    const updateLocation = (position: GeolocationPosition) => {
      const newLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      setUserLocation(newLocation);
      pageCache.set("map:userLocation", newLocation);
    };

    const handleError = (error: GeolocationPositionError) => {
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
  }, [pageCache]);

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
        pageCache.set("map:userLocation", newLocation);
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
        setGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  }, [pageCache]);

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
          latitude, longitude, country_code,
          is_anonymous, status, is_sensitive,
          confirmations, views, comment_count, report_count, created_at,
          post_media (id, post_id, url, thumbnail_url, media_type, is_sensitive)
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
        .filter((p: any) => isNigeriaPost(p.country_code, p.latitude, p.longitude))
        .map((p: any) => ({
          id: p.id,
          user_id: p.user_id,
          category: p.category,
          comment: p.comment,
          location: { latitude: p.latitude, longitude: p.longitude },
          country_code: p.country_code ?? null,
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
            thumbnail_url: m.thumbnail_url,
            media_type: m.media_type as "photo" | "video",
            is_sensitive: m.is_sensitive,
          })),
          tags: [],
        }));

      // Merge with anything already in state — preserves posts pulled in by
      // the ?post=<id> URL handler that may sit outside the 24-hour window.
      // Without this, fetchPosts() racing after the URL handler would wipe
      // the previewed post and leave a centered map with no marker/popup.
      setPosts((prev) => {
        if (prev.length === 0) return formatted;
        const formattedIds = new Set(formatted.map((p) => p.id));
        const extras = prev.filter((p) => !formattedIds.has(p.id));
        return [...formatted, ...extras];
      });
      feedCache.setPosts("map:posts", formatted);
    } catch (e) {
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
          voice_note_url, bearing, created_at, last_updated, resolved_at
        `)
        .eq("status", "active")
        .gte("created_at", twentyFourHoursAgo)
        .order("created_at", { ascending: false })
        .limit(200);

      if (sosError) {
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
        voice_note_url: s.voice_note_url,
        bearing: s.bearing,
        created_at: s.created_at,
        last_updated: s.last_updated,
        resolved_at: s.resolved_at,
        user: sosUserCacheRef.current[s.user_id] || undefined,
      }));

      setSOSAlerts(formatted);
      feedCache.setPosts("map:sos", formatted as any[]);

      if (!handledSosParamRef.current) {
        // 1) /map?sos=<id> — center on that SOS alert (and open it).
        if (sosIdFromUrl) {
          const match = formatted.find((x) => x.id === sosIdFromUrl);
          if (match) {
            setCenterOnSOS({ lat: match.latitude, lng: match.longitude });
            setOpenSOSId(match.id);
            handledSosParamRef.current = true;
            return;
          }
        }

        // 2) /map?lat=<n>&lng=<n> — pan/zoom to those coords. Used by post-card
        //    distance pills so tapping the distance navigates to that location.
        const lat = latFromUrl ? Number(latFromUrl) : NaN;
        const lng = lngFromUrl ? Number(lngFromUrl) : NaN;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setCenterOnSOS({ lat, lng });
          if (sosIdFromUrl) setOpenSOSId(sosIdFromUrl);
          handledSosParamRef.current = true;
        }
      }
    } catch (e) {
    }
  }, [sosIdFromUrl, latFromUrl, lngFromUrl, feedCache]);

  // Open the post-preview popup if we arrived via /map?post=<id> (PostCard distance pill).
  // The default fetchPosts() filters to the last 24h + status=live, so a post
  // outside that window won't be in `posts`. In that case we fetch the single
  // post directly and merge it into state so its marker and popup render.
  // The ref guard ensures we only act once per URL value — otherwise dismissing
  // the popup would immediately reopen it on the next render.
  useEffect(() => {
    if (!postIdFromUrl) return;
    if (handledPostParamRef.current === postIdFromUrl) return;
    let cancelled = false;

    const match = posts.find((p) => p.id === postIdFromUrl);
    if (match) {
      handledPostParamRef.current = postIdFromUrl;
      setPreviewPostId(match.id);
      if (match.location?.latitude && match.location?.longitude) {
        setCenterOnSOS({ lat: match.location.latitude, lng: match.location.longitude });
      }
      return;
    }

    // Not in local list — fetch it.
    (async () => {
      try {
        const { data } = await supabase
          .from("posts")
          .select(`
            id, user_id, category, comment, address,
            latitude, longitude,
            is_anonymous, status, is_sensitive,
            confirmations, views, comment_count, report_count, created_at,
            post_media (id, post_id, url, thumbnail_url, media_type, is_sensitive)
          `)
          .eq("id", postIdFromUrl)
          .maybeSingle();

        if (cancelled || !data || !data.latitude || !data.longitude) return;
        // Don't surface archived/deleted posts via a stale deep link.
        if (data.status !== "live" && data.status !== "resolved") return;

        const fetched: Post = {
          id: data.id,
          user_id: data.user_id,
          category: data.category,
          comment: data.comment,
          location: { latitude: data.latitude, longitude: data.longitude },
          address: data.address,
          is_anonymous: data.is_anonymous,
          status: data.status,
          is_sensitive: data.is_sensitive,
          confirmations: data.confirmations || 0,
          views: data.views || 0,
          comment_count: data.comment_count || 0,
          report_count: data.report_count || 0,
          created_at: data.created_at,
          media: (data.post_media || []).map((m: any) => ({
            id: m.id,
            post_id: m.post_id,
            url: m.url,
            thumbnail_url: m.thumbnail_url,
            media_type: m.media_type as "photo" | "video",
            is_sensitive: m.is_sensitive,
          })),
          tags: [],
        };
        handledPostParamRef.current = postIdFromUrl;
        setPosts((prev) => (prev.some((p) => p.id === fetched.id) ? prev : [fetched, ...prev]));
        setPreviewPostId(fetched.id);
        setCenterOnSOS({ lat: fetched.location!.latitude, lng: fetched.location!.longitude });
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [postIdFromUrl, posts]);

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
                  voice_note_url: newRow.voice_note_url,
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

  // Drop archived/deleted posts from the map markers AND the incident list
  // (both derive from `posts`) the moment a post is archived/removed anywhere.
  // Mirrors FeedContext: realtime for cross-device, local events for the
  // same session (e.g. an admin archiving on this device).
  useEffect(() => {
    const remove = (id?: string) => {
      if (!id) return;
      setPosts((prev) => prev.filter((p) => p.id !== id));
    };

    const unsub = realtimeManager.subscribeToPosts(
      undefined,
      (updated: any) => {
        if (updated?.status === "archived" || updated?.status === "deleted") {
          remove(updated.id);
        }
      },
      (deleted: any) => remove(deleted?.id),
    );

    const onArchived = (e: Event) => remove((e as CustomEvent).detail?.postId);
    window.addEventListener("peja-post-archived", onArchived);
    window.addEventListener("peja-post-deleted", onArchived);

    return () => {
      unsub();
      window.removeEventListener("peja-post-archived", onArchived);
      window.removeEventListener("peja-post-deleted", onArchived);
    };
  }, []);

  // ============================================================
  // ALL HOOKS ARE DONE
  // ============================================================

  const handlePostClick = (postId: string) => router.push(`/post/${postId}`);

  const filteredPosts = selectedCategory ? posts.filter((p) => p.category === selectedCategory) : posts;

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header variant="back" title="Map" onBack={() => router.back()} onCreateClick={() => router.push("/create")} showDefaultActions />

      <main className="pt-app-header-pill h-[100dvh]">
        {/* dvh tracks the visible viewport so the map + bottom drawer don't
            slip behind mobile browser chrome the way 100vh does. z-0 + isolate
            contains Leaflet's internal z-index panes (400-1000) below the
            fixed header / bottom nav (z-50) instead of painting over them. */}
        <div className="relative z-0 isolate h-[calc(100dvh-8rem)] lg:h-[calc(100dvh-4rem)]">
          {loading && !mapReady && posts.length === 0 ? (
            <div className="h-full bg-dark-800 flex items-center justify-center">
              <Skeleton className="h-[70vh] w-[92vw] max-w-5xl rounded-2xl" />
            </div>
          ) : (
            <IncidentMapBoundary>
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
                previewPostId={previewPostId}
                onPreviewClose={() => {
                  setPreviewPostId(null);
                  // Remove the post param from the URL so the effect doesn't
                  // reopen the popup, and so a refresh doesn't restore it.
                  if (typeof window !== "undefined" && window.location.search.includes("post=")) {
                    const params = new URLSearchParams(window.location.search);
                    params.delete("post");
                    const next = params.toString();
                    window.history.replaceState(null, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
                  }
                }}
              />
            </IncidentMapBoundary>
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

          <div
            className="absolute left-4 right-4 z-1000"
            style={{
              // Sits below the floating-pill Header bottom edge so the "All"
              // chip doesn't cover the back arrow on notched / status-bar
              // devices.
              top: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 16px) + 68px)",
            }}
          >
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

          {/* Bottom drawer (side buttons live INSIDE so they animate together) */}
          <div
            className={`absolute bottom-0 left-0 right-0 z-2000 transition-transform duration-300 ${
              showList ? "translate-y-0" : "translate-y-[calc(100%-60px)]"
            }`}
            style={{ maxHeight: "60%" }}
          >
            {/* Right column: compass + recenter — sit above the drawer's top edge */}
            <div className="absolute right-4 bottom-full pb-3 flex flex-col gap-2 z-10">
              <button
                onClick={async () => {
                  if (!compassEnabled) {
                    await requestCompassPermission();
                  } else {
                    setCompassEnabled(false);
                  }
                }}
                className={`p-3 rounded-full shadow-lg transition-colors ${
                  compassEnabled
                    ? "bg-primary-600 text-white"
                    : "glass-float text-primary-400 hover:bg-white/10"
                }`}
              >
                <Compass className="w-5 h-5" />
              </button>
              <button
                onClick={() => {
                  handleCenterOnUser();
                }}
                disabled={gettingLocation}
                className="p-3 glass-float rounded-full shadow-lg hover:bg-white/10"
              >
                {gettingLocation ? (
                  <PejaSpinner className="w-5 h-5" />
                ) : (
                  <Navigation className="w-5 h-5 text-primary-400" />
                )}
              </button>
            </div>

            {/* Left column: analytics */}
            <div className="absolute left-4 bottom-full pb-3 z-10">
              <button
                onClick={() => setShowAnalytics(true)}
                className="p-3 glass-float rounded-full shadow-lg hover:bg-white/10"
              >
                <BarChart3 className="w-5 h-5 text-primary-400" />
              </button>
            </div>

            {/* Drawer surface */}
            <div className="glass-strong rounded-t-2xl shadow-2xl" style={{ borderBottom: "none" }}>
              <button onClick={() => setShowList(!showList)} className="w-full py-3 flex flex-col items-center">
                <div className="w-10 h-1 bg-dark-600 rounded-full mb-1" />
                <span className="text-sm text-dark-400">{filteredPosts.length} incidents</span>
              </button>

              <div className="overflow-y-auto px-4 pb-4" style={{ maxHeight: "calc(60vh - 60px)" }}>
                {sosAlerts.length === 0 && filteredPosts.length === 0 && (
                  <div className="py-10 flex flex-col items-center text-center">
                    <div className="w-10 h-10 rounded-full bg-dark-700/50 flex items-center justify-center mb-3">
                      <MapPin className="w-5 h-5 text-dark-500" />
                    </div>
                    <p className="text-sm text-dark-300 font-medium">No nearby incidents</p>
                    <p className="text-xs text-dark-500 mt-1">
                      {selectedCategory ? "Try clearing the category filter" : "You're in the clear right now"}
                    </p>
                  </div>
                )}
                {/* SOS Alerts */}
                {sosAlerts.map((sos) => (
                <div
                  key={sos.id}
                  onClick={() => handleSOSClick(sos)}
                  className="flex gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl mb-2 cursor-pointer hover:bg-red-500/20 transition-colors"
                >
                  <AvatarImage
                    src={sos.user?.avatar_url}
                    wrapperClassName="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center overflow-hidden"
                    fallback={<AlertTriangle className="w-5 h-5 text-red-400" />}
                  />
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