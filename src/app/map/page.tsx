"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES } from "@/lib/types";
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
  Clock,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow, subHours } from "date-fns";

const IncidentMap = dynamic(() => import("@/components/map/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-dark-800">
      <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
    </div>
  ),
});

interface SOSAlert {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  address?: string;
  status: string;
  created_at: string;
  user?: {
    full_name: string;
    avatar_url?: string;
  };
}

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

  useEffect(() => {
    getUserLocation();
    fetchPosts();
    fetchSOSAlerts();

    // Real-time subscription for SOS
    const channel = supabase
      .channel('sos-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => {
        fetchSOSAlerts();
      })
      .subscribe();

    const interval = setInterval(fetchSOSAlerts, 30000);

    return () => {
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

        // Update in DB
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
        console.error("Location error:", error);
        setGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  const fetchPosts = async () => {
    try {
      const twentyFourHoursAgo = subHours(new Date(), 24).toISOString();

      const { data, error } = await supabase
        .from("posts")
        .select(`
          id, user_id, category, comment, address, 
          latitude, longitude,
          is_anonymous, status, is_sensitive, 
          confirmations, views, created_at,
          post_media (id, url, media_type)
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
          created_at: post.created_at,
          media: post.post_media || [],
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
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from("sos_alerts")
        .select("id, user_id, latitude, longitude, address, status, created_at")
        .eq("status", "active")
        .gte("created_at", fiveHoursAgo);

      if (error) throw error;

      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(s => s.user_id))];
        const { data: users } = await supabase
          .from("users")
          .select("id, full_name, avatar_url")
          .in("id", userIds);

        const userMap: Record<string, any> = {};
        users?.forEach(u => { userMap[u.id] = u; });

        setSOSAlerts(data.map(sos => ({ ...sos, user: userMap[sos.user_id] })));
      } else {
        setSOSAlerts([]);
      }
    } catch (error) {
      console.error("Error fetching SOS:", error);
    }
  };

  const handlePostClick = (postId: string) => router.push(`/post/${postId}`);

  const filteredPosts = selectedCategory
    ? posts.filter((p) => p.category === selectedCategory)
    : posts;

  // Default center (Lagos) or user location
  const defaultCenter: [number, number] = [6.5244, 3.3792];

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header onMenuClick={() => setSidebarOpen(true)} onCreateClick={() => router.push("/create")} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="pt-16 lg:pl-64 h-screen">
        <div className="relative h-[calc(100vh-8rem)] lg:h-[calc(100vh-4rem)]">
          {loading ? (
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
            />
          )}

          {/* SOS Banner */}
          {sosAlerts.length > 0 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] glass-float rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" />
              <span className="text-sm font-medium text-red-400">
                {sosAlerts.length} Active SOS
              </span>
            </div>
          )}

          {/* Filters */}
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

          {/* My Location Button */}
          <button
            onClick={getUserLocation}
            disabled={gettingLocation}
            className="absolute bottom-24 right-4 z-[1000] p-3 glass-float rounded-full shadow-lg hover:bg-white/10"
          >
            {gettingLocation ? (
              <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
            ) : (
              <Navigation className="w-5 h-5 text-primary-400" />
            )}
          </button>

          {/* List Toggle */}
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
              {/* SOS Alerts */}
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