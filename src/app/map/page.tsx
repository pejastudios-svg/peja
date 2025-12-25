"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES, SOSAlert } from "@/lib/types";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Sidebar } from "@/components/layout/Sidebar";
import { Badge } from "@/components/ui/Badge";
import {
  Loader2,
  MapPin,
  Navigation,
  List,
  Map as MapIcon,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow, subHours } from "date-fns";

// Dynamic import with SSR disabled - THIS IS THE KEY FIX
const IncidentMap = dynamic(
  () => import("@/components/map/IncidentMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center bg-dark-800">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    ),
  }
);

export default function MapPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [sosAlerts, setSOSAlerts] = useState<SOSAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showList, setShowList] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [shouldCenterOnUser, setShouldCenterOnUser] = useState(false);

  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      setMapReady(true);
    }, 100);

    getUserLocation();
    fetchPosts();
    fetchSOSAlerts();

    const channel = supabase
      .channel('sos-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => {
        fetchSOSAlerts();
      })
      .subscribe();

    const interval = setInterval(fetchSOSAlerts, 30000);

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const getUserLocation = useCallback(() => {
    setGettingLocation(true);
    
    if (!navigator.geolocation) {
      console.log("Geolocation not supported");
      setGettingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const newLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        console.log("Got user location:", newLocation);
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
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 }
    );
  }, []);

  const handleCenterOnUser = useCallback(() => {
    getUserLocation();
    setShouldCenterOnUser(true);
    // Reset after a short delay
    setTimeout(() => setShouldCenterOnUser(false), 1000);
  }, [getUserLocation]);

  const fetchPosts = async () => {
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

      const formattedPosts: Post[] = (data || [])
        .filter(post => post.latitude && post.longitude)
        .map((post) => ({
          id: post.id,
          user_id: post.user_id,
          category: post.category,
          comment: post.comment,
          location: { 
            latitude: post.latitude, 
            longitude: post.longitude 
          },
          address: post.address,
          is_anonymous: post.is_anonymous,
          status: post.status,
          is_sensitive: post.is_sensitive,
          confirmations: post.confirmations || 0,
          views: post.views || 0,
          comment_count: post.comment_count || 0,
          report_count: post.report_count || 0,
          created_at: post.created_at,
          media: post.post_media?.map((m: any) => ({
            id: m.id,
            post_id: m.post_id,
            url: m.url,
            media_type: m.media_type as "photo" | "video",
            is_sensitive: m.is_sensitive,
          })) || [],
          tags: [],
        }));

      console.log(`Loaded ${formattedPosts.length} posts with coordinates`);
      setPosts(formattedPosts);
    } catch (error) {
      console.error("Error fetching posts:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSOSAlerts = async () => {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: sosData, error: sosError } = await supabase
        .from("sos_alerts")
        .select("*")
        .eq("status", "active")
        .gte("created_at", twentyFourHoursAgo);

      if (sosError) {
        console.error("SOS query error:", sosError);
        setSOSAlerts([]);
        return;
      }

      if (!sosData || sosData.length === 0) {
        console.log("No active SOS alerts");
        setSOSAlerts([]);
        return;
      }

      console.log(`Found ${sosData.length} active SOS alerts`);

      const userIds = [...new Set(sosData.map(s => s.user_id))];
      
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .in("id", userIds);

      if (usersError) {
        console.error("Users query error:", usersError);
      }

      const userMap: Record<string, any> = {};
      if (users && users.length > 0) {
        users.forEach(u => {
          userMap[u.id] = {
            full_name: u.full_name,
            avatar_url: u.avatar_url,
          };
        });
      }

      const formattedSOSAlerts: SOSAlert[] = sosData.map(sos => ({
        id: sos.id,
        user_id: sos.user_id,
        latitude: sos.latitude,
        longitude: sos.longitude,
        address: sos.address,
        status: sos.status as "active" | "resolved" | "false_alarm" | "cancelled",
        tag: sos.tag,
        message: sos.message,
        voice_note_url: sos.voice_note_url,
        bearing: sos.bearing,
        created_at: sos.created_at,
        last_updated: sos.last_updated,
        resolved_at: sos.resolved_at,
        user: userMap[sos.user_id],
      }));

      setSOSAlerts(formattedSOSAlerts);
    } catch (error) {
      console.error("Error fetching SOS:", error);
      setSOSAlerts([]);
    }
  };

  const handlePostClick = (postId: string) => router.push(`/post/${postId}`);

  const filteredPosts = selectedCategory
    ? posts.filter((p) => p.category === selectedCategory)
    : posts;

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header onMenuClick={() => setSidebarOpen(true)} onCreateClick={() => router.push("/create")} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="pt-16 lg:pl-64 h-screen">
        <div className="relative h-[calc(100vh-8rem)] lg:h-[calc(100vh-4rem)]">
          {loading || !mapReady ? (
            <div className="h-full flex items-center justify-center bg-dark-800">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
          ) : (
            <IncidentMap
              posts={filteredPosts}
              userLocation={userLocation}
              onPostClick={handlePostClick}
              sosAlerts={sosAlerts}
              onSOSClick={(id) => console.log("SOS:", id)}
              centerOnUser={shouldCenterOnUser}
            />
          )}

          {/* SOS Alert Banner */}
          {sosAlerts.length > 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000]">
              <div className="glass-float rounded-xl px-4 py-2.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
                </div>
                <span className="text-sm font-semibold text-red-400 whitespace-nowrap">
                  {sosAlerts.length} Active SOS
                </span>
              </div>
            </div>
          )}

          {/* Category Filter */}
          <div className="absolute top-16 left-4 right-4 z-[1000]">
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

          {/* Navigation Button */}
          <button
            onClick={handleCenterOnUser}
            disabled={gettingLocation}
            className="absolute bottom-24 right-4 z-[1000] p-3 glass-float rounded-full shadow-lg hover:bg-white/10"
          >
            {gettingLocation ? (
              <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
            ) : (
              <Navigation className="w-5 h-5 text-primary-400" />
            )}
          </button>

          {/* List Toggle Button */}
          <button
            onClick={() => setShowList(!showList)}
            className="absolute bottom-24 left-4 z-[1000] p-3 glass-float rounded-full shadow-lg"
          >
            {showList ? <MapIcon className="w-5 h-5 text-primary-400" /> : <List className="w-5 h-5 text-primary-400" />}
          </button>

          {/* Bottom Sheet */}
          <div
            className={`absolute bottom-0 left-0 right-0 z-[1000] glass-strong rounded-t-2xl shadow-2xl transition-transform duration-300 ${
              showList ? "translate-y-0" : "translate-y-[calc(100%-60px)]"
            }`}
            style={{ maxHeight: "60%" }}
          >
            <button onClick={() => setShowList(!showList)} className="w-full py-3 flex flex-col items-center">
              <div className="w-10 h-1 bg-dark-600 rounded-full mb-1" />
              <span className="text-sm text-dark-400">
                {filteredPosts.length} incidents
              </span>
            </button>

            <div className="overflow-y-auto px-4 pb-4" style={{ maxHeight: "calc(60vh - 60px)" }}>
              {/* SOS Alerts in List */}
              {sosAlerts.map((sos) => (
                <div key={sos.id} className="flex gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl mb-2">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center overflow-hidden">
                    {sos.user?.avatar_url ? (
                      <img src={sos.user.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-red-400">{sos.user?.full_name || "Someone"} needs help!</p>
                    <p className="text-xs text-dark-400">{sos.address}</p>
                  </div>
                </div>
              ))}

              {/* Posts in List */}
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
                      {post.comment && <p className="text-sm text-dark-200 line-clamp-1 mt-1">{post.comment}</p>}
                      <p className="text-xs text-dark-500 mt-1">{post.address}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="absolute top-32 right-4 z-[1000] glass-float rounded-lg p-3 text-xs space-y-2">
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
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}