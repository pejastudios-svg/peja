"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Menu, Plus, User, Search, ArrowLeft } from "lucide-react";
import { Button } from "../ui/Button";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";


interface HeaderProps {
  onMenuClick?: () => void;
  onCreateClick?: () => void;
  variant?: "default" | "back";
  title?: string;
  onBack?: () => void;
}

export function Header({ onMenuClick, onCreateClick, variant = "default", title, onBack }: HeaderProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (user) {
      fetchUnreadCount();
      setupRealtime();
      const handler = () => fetchUnreadCount();
     window.addEventListener("peja-notifications-changed", handler);

    return () => {
    window.removeEventListener("peja-notifications-changed", handler);
    };
    }
  }, [user]);

  const fetchUnreadCount = async () => {
    if (!user) return;

    try {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (!error) {
        setUnreadCount(count || 0);
      }
    } catch (error) {
      console.error("Error fetching unread count:", error);
    }
  };

  // Real-time subscription
  const setupRealtime = () => {
    if (!user) return;

    const channel = supabase
      .channel('header-notifications')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all changes
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Refetch count on any change
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

return (
  <header className="fixed top-0 left-0 right-0 z-50 glass-header pt-[env(safe-area-inset-top,0px)]">
    <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {variant === "back" ? (
          <button
            onClick={onBack || (() => router.back())}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors flex items-center gap-2"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
            <span className="text-lg font-semibold text-dark-100">{title || "Back"}</span>
          </button>
        ) : (
          <div className="flex flex-col">
            <a 
              href="https://www.youtube.com/@PejaStudios" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center peja-logo-morph"
              aria-label="Peja Studios YouTube"
            >
              <span className="peja-logo-text text-2xl font-bold tracking-wider">PEJA</span>
              <svg 
                className="peja-logo-youtube" 
                viewBox="0 0 24 24" 
                width="28" 
                height="28"
                fill="currentColor"
              >
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </a>
            <span className="text-[10px] text-dark-400 -mt-0.5 tracking-wide">Your Brother's Keeper</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push("/search")}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <Search className="w-5 h-5 text-dark-200" />
        </button>
        <Link
          href="/notifications"
          className="relative p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <Bell className="w-5 h-5 text-dark-200" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>
      </div>
    </div>
  </header>
);
}