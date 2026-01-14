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
    <header className="fixed top-0 left-0 right-0 z-50 glass-header">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
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
    <Link href="/" className="flex items-center">
      <span className="text-2xl font-bold text-gradient">Peja</span>
    </Link>
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