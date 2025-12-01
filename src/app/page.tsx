"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { PostCard } from "@/components/posts/PostCard";
import { Button } from "@/components/ui/Button";
import { Post } from "@/lib/types";
import { TrendingUp, MapPin, Users } from "lucide-react";

const MOCK_POSTS: Post[] = [
  {
    id: "1",
    category: "accident",
    comment: "Multiple cars involved on Lekki-Epe expressway. LASTMA on scene. Avoid this route if possible.",
    location: { latitude: 6.4541, longitude: 3.4204 },
    address: "Lekki Phase 1, Lagos",
    is_anonymous: false,
    status: "live",
    is_sensitive: false,
    confirmations: 45,
    views: 1203,
    created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    media: [
      {
        id: "m1",
        post_id: "1",
        url: "https://images.unsplash.com/photo-1562690868-60bbe7293e94?w=800",
        media_type: "photo",
        is_sensitive: false,
      },
    ],
    tags: ["lekki", "expressway", "traffic"],
    distance: 400,
  },
  {
    id: "2",
    category: "crime",
    comment: "Robbery incident reported. Police have been contacted.",
    location: { latitude: 6.4281, longitude: 3.4219 },
    address: "Victoria Island, Lagos",
    is_anonymous: true,
    status: "live",
    is_sensitive: true,
    confirmations: 28,
    views: 856,
    created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    media: [
      {
        id: "m2",
        post_id: "2",
        url: "https://images.unsplash.com/photo-1617575521317-d2974f3b56d2?w=800",
        media_type: "photo",
        is_sensitive: true,
      },
    ],
    tags: ["security", "alert"],
    distance: 1200,
  },
  {
    id: "3",
    category: "flooding",
    comment: "Heavy flooding on this street. Water reaching knee level.",
    location: { latitude: 6.5244, longitude: 3.3792 },
    address: "Yaba, Lagos",
    is_anonymous: false,
    status: "live",
    is_sensitive: false,
    confirmations: 67,
    views: 2104,
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    media: [
      {
        id: "m3",
        post_id: "3",
        url: "https://images.unsplash.com/photo-1547683905-f686c993aae5?w=800",
        media_type: "photo",
        is_sensitive: false,
      },
    ],
    tags: ["flooding", "yaba"],
    distance: 2500,
  },
];

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"nearby" | "following" | "trending">("nearby");

  const handleConfirmPost = (postId: string) => {
    console.log("Confirming post:", postId);
  };

  const handleSharePost = (post: Post) => {
    if (navigator.share) {
      navigator.share({
        title: "Peja Alert",
        text: post.comment || "Check out this incident",
        url: window.location.href,
      });
    }
  };

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header
        onMenuClick={() => setSidebarOpen(true)}
        onCreateClick={() => console.log("Create clicked")}
      />

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="pt-16 lg:pl-64">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide">
            <Button
              variant={activeTab === "nearby" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("nearby")}
              leftIcon={<MapPin className="w-4 h-4" />}
            >
              Nearby
            </Button>
            <Button
              variant={activeTab === "following" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("following")}
              leftIcon={<Users className="w-4 h-4" />}
            >
              Following
            </Button>
            <Button
              variant={activeTab === "trending" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("trending")}
              leftIcon={<TrendingUp className="w-4 h-4" />}
            >
              Trending
            </Button>
          </div>

          <div className="space-y-4">
            {MOCK_POSTS.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onConfirm={handleConfirmPost}
                onShare={handleSharePost}
              />
            ))}
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}