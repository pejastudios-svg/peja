"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Bell, ArrowLeft, User, MessageCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useMessageCache } from "@/context/MessageCacheContext";
import { supabase } from "@/lib/supabase";

interface HeaderProps {
  onMenuClick?: () => void;
  onCreateClick?: () => void;
  variant?: "default" | "back";
  title?: string;
  onBack?: () => void;
}

// Dark-mode liquid glass: light enough to show distortion, dark enough to read icons
const GLASS: React.CSSProperties = {
  background: "rgba(40, 30, 60, 0.45)",
  backdropFilter: "blur(50px) saturate(180%)",
  WebkitBackdropFilter: "blur(50px) saturate(180%)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  boxShadow:
    "0 2px 20px rgba(0, 0, 0, 0.25), inset 0 0.5px 0 rgba(255, 255, 255, 0.1)",
  borderRadius: "16px",
};

export function Header({
  onMenuClick,
  onCreateClick,
  variant = "default",
  title,
  onBack,
}: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { conversations } = useMessageCache();
  const [unreadCount, setUnreadCount] = useState(0);

  const isVip = user?.is_vip === true;
  const dmUnread = isVip
    ? conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0)
    : 0;

  useEffect(() => {
    if (user) {
      fetchUnreadCount();
      const cleanup = setupRealtime();
      const handler = () => fetchUnreadCount();
      window.addEventListener("peja-notifications-changed", handler);
      return () => {
        window.removeEventListener("peja-notifications-changed", handler);
        cleanup?.();
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
      if (!error) setUnreadCount(count || 0);
    } catch {}
  };

  const setupRealtime = () => {
    if (!user) return;
    const channel = supabase
      .channel("header-notifications")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => fetchUnreadCount()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  };

  // Back variant — single bar with back + actions
  if (variant === "back") {
    return (
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center gap-2 px-3 pt-2">
          <div className="flex items-center h-11 px-3 flex-1" style={GLASS}>
            <button
              onClick={onBack || (() => router.back())}
              className="flex items-center gap-1.5 p-0.5 rounded-lg active:opacity-70 transition-opacity"
            >
              <ArrowLeft className="w-5 h-5 text-white/80" strokeWidth={2.5} />
              <span className="text-[15px] font-semibold text-white/90">
                {title || "Back"}
              </span>
            </button>
          </div>

          <div className="flex items-center h-11 px-1.5 gap-0.5" style={GLASS}>
            <Link
              href="/notifications"
              className="relative p-2 rounded-xl active:bg-white/10 transition-colors"
            >
              <Bell className="w-5 h-5 text-white/60" strokeWidth={2.3} />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold rounded-full px-1"
                  style={{
                    background: "#ef4444",
                    color: "white",
                    boxShadow: "0 0 6px rgba(239,68,68,0.5)",
                  }}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>
    );
  }

  // Default — two floating pills
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
  {/* ── Logo pill ── */}
<div className="flex items-center h-11 px-3" style={GLASS}>
  <a
    href="https://www.youtube.com/@PejaStudios"
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-1.5 peja-logo-morph"
    aria-label="Peja Studios YouTube"
  >
    <span
      className="peja-logo-text text-[17px]"
      style={{ color: "#a78bfa", fontWeight: 900 }}
    >
      PEJA
    </span>
    <svg
      className="peja-logo-youtube"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="#ef4444"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  </a>
</div>

        <div className="flex-1" />

        {/* ── Actions pill ── */}
        <div className="flex items-center h-11 px-1.5 gap-0.5" style={GLASS}>
          {/* VIP Messages */}
          {isVip && (
            <Link
              href="/messages"
              className={`relative p-2 rounded-xl transition-colors active:bg-white/10 ${
                pathname === "/messages" ? "bg-white/10" : ""
              }`}
            >
              <MessageCircle
                className="w-5 h-5"
                style={{
                  color:
                    pathname === "/messages"
                      ? "#c4b5fd"
                      : "rgba(255,255,255,0.55)",
                }}
                strokeWidth={2.3}
              />
              {dmUnread > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold rounded-full px-1"
                  style={{
                    background: "#8b5cf6",
                    color: "white",
                    boxShadow: "0 0 6px rgba(139,92,246,0.5)",
                  }}
                >
                  {dmUnread > 99 ? "99+" : dmUnread}
                </span>
              )}
            </Link>
          )}

          {/* Notifications */}
          <Link
            href="/notifications"
            className={`relative p-2 rounded-xl transition-colors active:bg-white/10 ${
              pathname === "/notifications" ? "bg-white/10" : ""
            }`}
          >
            <Bell
              className="w-5 h-5"
              style={{
                color:
                  pathname === "/notifications"
                    ? "#c4b5fd"
                    : "rgba(255,255,255,0.55)",
              }}
              strokeWidth={2.3}
            />
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold rounded-full px-1"
                style={{
                  background: "#ef4444",
                  color: "white",
                  boxShadow: "0 0 6px rgba(239,68,68,0.5)",
                }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>

          {/* Profile */}
          <Link
            href="/profile"
            className={`p-1.5 rounded-xl transition-colors active:bg-white/10 ${
              pathname === "/profile" ? "bg-white/10" : ""
            }`}
          >
            <div
              className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center transition-all duration-300"
              style={{
                border:
                  pathname === "/profile"
                    ? "2px solid rgba(167,139,250,0.7)"
                    : "2px solid rgba(255,255,255,0.12)",
                background: "rgba(139,92,246,0.12)",
              }}
            >
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <User
                  className="w-3.5 h-3.5"
                  style={{ color: "rgba(255,255,255,0.45)" }}
                />
              )}
            </div>
          </Link>
        </div>
      </div>
    </header>
  );
}
