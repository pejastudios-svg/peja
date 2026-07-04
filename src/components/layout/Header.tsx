"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Bell, ArrowLeft, MessageCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "@/features/chat/store";
import { supabase } from "@/lib/supabase";
import { AvatarImage } from "@/components/ui/AvatarImage";

interface HeaderProps {
  onMenuClick?: () => void;
  onCreateClick?: () => void;
  variant?: "default" | "back";
  title?: string;
  onBack?: () => void;
  // Back variant only. A small status line rendered under the title — used
  // by the chat thread to show "online" / "typing…" / "last seen 3m ago".
  // Renders nothing when undefined.
  subtitle?: ReactNode;
  // Back variant only. Renders a second pill with custom right-side content.
  // If unset and `showDefaultActions` is false, no right-side pill is rendered
  // (the back pill stretches to fill).
  actions?: ReactNode;
  // Back variant only. When true, the actions slot renders WITHOUT
  // the surrounding glass pill — for callers that supply their own
  // fully-styled button (e.g. Settings' Save) that would otherwise
  // sit awkwardly inside a wrapper chip.
  actionsBare?: boolean;
  // Back variant only. Renders the default bell pill. Used by
  // Map / Notifications which want to expose those even on back-style pages.
  showDefaultActions?: boolean;
  // Back variant only. Small circular avatar rendered between the back arrow
  // and the title — used by the chat thread to show the other user's profile
  // pic. `undefined` (default) renders no slot; `null` renders a placeholder
  // user icon; a string renders the image.
  avatarUrl?: string | null;
  // Back variant only. When set, the avatar becomes its own tap target
  // (so e.g. the chat thread can pop a circular preview modal). When
  // undefined the avatar is decorative.
  onAvatarTap?: () => void;
  // Back variant only. When set, the title+subtitle area becomes a
  // separate tap target (so e.g. tapping the name opens the chat
  // info sheet). When undefined the whole back pill behaves as one
  // back button — current behaviour, preserved for the other pages.
  onTitleTap?: () => void;
}

// Retired: this was a backdrop-filter blur layer (with a mask gradient — the
// blur + mask combo is a heavy compositing trigger). The header pills are now
// opaque, so there's nothing to blur behind them. Rendering it caused the very
// black-rectangle GPU artifact this comment used to describe.
function HeaderBlurFade() {
  return null;
}

// Header pill surface. Opaque (--glass-header-bg is now a solid colour) and
// WITHOUT backdrop-filter: even blur(20px) still triggered Android WebView
// compositor glitches (black rectangles over text / stacked glass) on some
// GPUs. An opaque pill has nothing to blur, so the artifact can't occur.
const GLASS: React.CSSProperties = {
  background: "var(--glass-header-bg)",
  border: "1px solid var(--glass-border)",
  boxShadow: "var(--glass-shadow-header)",
  borderRadius: "9999px",
};

// Icon-only circular pill. Used by the back button (split out of the
// title pill so the layout reads as "back chip + title chip" instead
// of one merged surface), and could host any other single-icon action.
const GLASS_CIRCLE: React.CSSProperties = {
  ...GLASS,
  borderRadius: "9999px",
};

export function Header({
  onMenuClick,
  onCreateClick,
  variant = "default",
  title,
  onBack,
  subtitle,
  actions,
  actionsBare = false,
  showDefaultActions = false,
  avatarUrl,
  onAvatarTap,
  onTitleTap,
}: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  // v2 chat store: conversationsById is populated globally by the
  // ChatBootstrap component mounted in app/layout.tsx (same role v1's
  // MessageCacheProvider played). Selector returns the record so we
  // can sum unread_count without re-rendering on unrelated store
  // changes.
  const conversationsById = useChatStore((s) => s.conversationsById);
  const [unreadCount, setUnreadCount] = useState(0);

  // Show the message button to anyone who can actually message — that's
  // VIPs and MVPs (and admins, who can DM anyone). Regular users see no
  // button at all; the v1 version only checked is_vip and locked MVPs
  // out by accident.
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

  // Back variant — back pill + optional actions pill
  if (variant === "back") {
    return (
      <header
        className="fixed top-0 left-0 right-0 z-50"
        style={{ paddingTop: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 16px) + 8px)" }}
      >
        <HeaderBlurFade />
        <div className="flex items-center gap-2 px-3 pt-2">
          {/* Back button — its own circular pill, separate from the title
              pill (Slack-style). Doesn't render on the split-targets path
              since that path inlines the back arrow inside the title pill
              so avatar/title can each be their own buttons without nesting. */}
          {!(onAvatarTap || onTitleTap) && (
            <button
              type="button"
              onClick={onBack || (() => router.back())}
              className="flex items-center justify-center h-11 w-11 shrink-0 active:opacity-70 transition-opacity"
              style={GLASS_CIRCLE}
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 text-dark-200" strokeWidth={2.5} />
            </button>
          )}
          <div className="flex items-center h-11 px-3 flex-1 min-w-0" style={GLASS}>
            {(() => {
              // Two layouts share the back pill:
              //
              //   • One-big-button (default): the entire pill is one back
              //     button — current behaviour for the rest of the app.
              //
              //   • Split tap targets (opted in by passing onAvatarTap or
              //     onTitleTap): the back arrow, avatar, and title become
              //     three separate buttons so the chat thread can route
              //     avatar-tap to the preview modal and name-tap to the
              //     chat info sheet. Nested <button> is invalid HTML, so
              //     we deliberately can't keep the whole row as one
              //     button when the children need to be tappable.
              const splitTargets = onAvatarTap || onTitleTap;

              const avatarContent = avatarUrl !== undefined && (
                <AvatarImage
                  src={avatarUrl}
                  wrapperClassName="w-7 h-7 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-[var(--chat-other-bg)]"
                />
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
                // Back arrow now lives in its own circular pill above —
                // the title pill is title-only (plus optional avatar).
                return (
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {avatarContent}
                    {titleContent}
                  </div>
                );
              }

              return (
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={onBack || (() => router.back())}
                    className="p-0.5 rounded-lg active:opacity-70 transition-opacity shrink-0"
                    aria-label="Back"
                  >
                    <ArrowLeft className="w-5 h-5 text-dark-200" strokeWidth={2.5} />
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
                      className="min-w-0 flex-1 p-0.5 rounded-lg active:opacity-70 transition-opacity text-left"
                    >
                      {titleContent}
                    </button>
                  ) : (
                    titleContent
                  )}
                </div>
              );
            })()}
          </div>

          {actions ? (
            actionsBare ? (
              // Bare slot — caller provides its own fully-styled button.
              <div className="flex items-center shrink-0">{actions}</div>
            ) : (
              <div className="flex items-center h-11 px-1.5 gap-0.5" style={GLASS}>
                {actions}
              </div>
            )
          ) : showDefaultActions ? (
            <div className="flex items-center h-11 px-1.5 gap-0.5" style={GLASS}>
              <Link
                href="/notifications"
                className="relative p-2 rounded-xl active:bg-white/10 transition-colors"
              >
                <Bell className="w-5 h-5 text-dark-300" strokeWidth={2.3} />
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
          ) : null}
        </div>
      </header>
    );
  }

  // Default — two floating pills
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 32px)" }}
    >
      <HeaderBlurFade />
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
          {/* DM entry — gated to VIPs/MVPs/admins (regular users get nothing) */}
          {canMessage && (
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
                      : "var(--color-dark-300)",
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
          <Link href="/notifications" data-tutorial="header-notifications"
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
                    : "var(--color-dark-300)",
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
          <Link href="/profile" data-tutorial="header-profile" 
            className={`p-1.5 rounded-xl transition-colors active:bg-white/10 ${
              pathname === "/profile" ? "bg-white/10" : ""
            }`}
          >
            <div
              className="contents"
            >
              <AvatarImage
                src={user?.avatar_url}
                wrapperClassName="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center transition-all duration-300"
                wrapperStyle={{
                  border:
                    pathname === "/profile"
                      ? "2px solid rgba(167,139,250,0.7)"
                      : "2px solid rgba(255,255,255,0.12)",
                  background: "rgba(139,92,246,0.12)",
                }}
              />
            </div>
          </Link>
        </div>
      </div>
    </header>
  );
}
