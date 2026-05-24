"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Bell, ArrowLeft, User, MessageCircle, Sun, Moon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "@/features/chat/store";
import { useTheme } from "@/context/ThemeContext";
import { supabase } from "@/lib/supabase";

interface HeaderProps {
  onMenuClick?: () => void;
  onCreateClick?: () => void;
  variant?: "default" | "back";
  title?: string;
  onBack?: () => void;
  subtitle?: ReactNode;
  actions?: ReactNode;
  showDefaultActions?: boolean;
  avatarUrl?: string | null;
  onAvatarTap?: () => void;
  onTitleTap?: () => void;
  /** sticky keeps the bar in the scroll container (forms/overlays); fixed for main tabs */
  dock?: "fixed" | "sticky";
}

function HeaderIconButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`relative p-2 rounded-lg active:opacity-70 transition-opacity ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Header({
  onMenuClick,
  onCreateClick,
  variant = "default",
  title,
  onBack,
  subtitle,
  actions,
  showDefaultActions = false,
  avatarUrl,
  onAvatarTap,
  onTitleTap,
  dock = "fixed",
}: HeaderProps) {
  const dockClass =
    dock === "sticky"
      ? "sticky top-0 z-50 glass-header"
      : "fixed top-0 left-0 right-0 z-50 glass-header";
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const conversationsById = useChatStore((s) => s.conversationsById);
  const { theme, toggle: toggleTheme } = useTheme();
  const [unreadCount, setUnreadCount] = useState(0);

  const canMessage =
    user?.is_vip === true || user?.is_mvp === true || user?.is_admin === true;
  const dmUnread = canMessage
    ? Object.values(conversationsById).reduce(
        (sum, c) => sum + (c.unread_count || 0),
        0
      )
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

  const renderThemeToggle = () => (
    <HeaderIconButton onClick={toggleTheme} aria-label="Toggle theme">
      {theme === "dark" ? (
        <Sun className="w-6 h-6 text-dark-200" strokeWidth={2} />
      ) : (
        <Moon className="w-6 h-6 text-dark-200" strokeWidth={2} />
      )}
    </HeaderIconButton>
  );

  const renderNotifications = () => (
    <Link
      href="/notifications"
      data-tutorial="header-notifications"
      className={`relative p-2 rounded-lg active:opacity-70 transition-opacity ${
        pathname === "/notifications" ? "opacity-100" : ""
      }`}
      aria-label="Notifications"
    >
      <Bell
        className="w-6 h-6"
        style={{
          color:
            pathname === "/notifications"
              ? "var(--nav-active)"
              : "var(--color-dark-200)",
        }}
        strokeWidth={pathname === "/notifications" ? 2.5 : 2}
      />
      {unreadCount > 0 && (
        <span className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold rounded-full px-1 bg-red-500 text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );

  const renderBackContent = () => {
    const splitTargets = onAvatarTap || onTitleTap;

    const avatarContent = avatarUrl !== undefined && (
      <span className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-[var(--chat-other-bg)]">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <User className="w-4 h-4" style={{ color: "var(--color-dark-400)" }} />
        )}
      </span>
    );

    const titleContent = (
      <span className="flex flex-col min-w-0 items-start leading-tight">
        <span className="text-[15px] font-semibold text-dark-100 truncate max-w-full">
          {title || "Back"}
        </span>
        {subtitle && (
          <span className="text-[11px] text-dark-400 truncate max-w-full">
            {subtitle}
          </span>
        )}
      </span>
    );

    if (!splitTargets) {
      return (
        <button
          onClick={onBack || (() => router.back())}
          className="flex items-center gap-2 min-w-0 flex-1 active:opacity-70 transition-opacity"
        >
          <ArrowLeft className="w-6 h-6 text-dark-100 shrink-0" strokeWidth={2.5} />
          {avatarContent}
          {titleContent}
        </button>
      );
    }

    return (
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          onClick={onBack || (() => router.back())}
          className="shrink-0 active:opacity-70 transition-opacity"
          aria-label="Back"
        >
          <ArrowLeft className="w-6 h-6 text-dark-100" strokeWidth={2.5} />
        </button>
        {avatarUrl !== undefined &&
          (onAvatarTap ? (
            <button
              type="button"
              onClick={onAvatarTap}
              className="shrink-0 active:opacity-70 transition-opacity"
              aria-label="View profile picture"
            >
              {avatarContent}
            </button>
          ) : (
            avatarContent
          ))}
        {onTitleTap ? (
          <button
            type="button"
            onClick={onTitleTap}
            className="min-w-0 flex-1 active:opacity-70 transition-opacity text-left"
          >
            {titleContent}
          </button>
        ) : (
          titleContent
        )}
      </div>
    );
  };

  if (variant === "back") {
    return (
      <header className={dockClass}>
        <div className="flex items-center h-12 px-3 gap-1 max-w-2xl mx-auto w-full">
          <div className="flex items-center min-w-0 flex-1">{renderBackContent()}</div>
          {actions ? (
            <div className="flex items-center gap-0.5 shrink-0">{actions}</div>
          ) : showDefaultActions ? (
            <div className="flex items-center gap-0.5 shrink-0">
              {renderThemeToggle()}
              {renderNotifications()}
            </div>
          ) : null}
        </div>
      </header>
    );
  }

  return (
    <header className={dockClass}>
      <div className="flex items-center h-12 px-4 max-w-2xl mx-auto w-full">
        <a
          href="https://www.youtube.com/@PejaStudios"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 peja-logo-morph shrink-0"
          aria-label="Peja Studios YouTube"
        >
          <span
            className="peja-logo-text text-[20px] tracking-tight"
            style={{ color: "#a78bfa", fontWeight: 800 }}
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

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 shrink-0">
          {renderThemeToggle()}

          {canMessage && (
            <Link
              href="/messages"
              className="relative p-2 rounded-lg active:opacity-70 transition-opacity"
              aria-label="Messages"
            >
              <MessageCircle
                className="w-6 h-6"
                style={{
                  color:
                    pathname === "/messages"
                      ? "var(--nav-active)"
                      : "var(--color-dark-200)",
                }}
                strokeWidth={pathname === "/messages" ? 2.5 : 2}
              />
              {dmUnread > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold rounded-full px-1 bg-primary-600 text-white">
                  {dmUnread > 99 ? "99+" : dmUnread}
                </span>
              )}
            </Link>
          )}

          {renderNotifications()}

          <Link
            href="/profile"
            data-tutorial="header-profile"
            className="p-1.5 rounded-lg active:opacity-70 transition-opacity"
            aria-label="Profile"
          >
            <div
              className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center"
              style={{
                border:
                  pathname === "/profile"
                    ? "2px solid var(--nav-active)"
                    : "2px solid var(--border-default)",
                background: "var(--soft-surface)",
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
                  style={{ color: "var(--color-dark-400)" }}
                />
              )}
            </div>
          </Link>
        </div>
      </div>
    </header>
  );
}
