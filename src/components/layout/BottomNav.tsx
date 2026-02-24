"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Home, Map, PlusCircle, User, MessageCircle } from "lucide-react";
import { SOSButton } from "../sos/SOSButton";
import { useAuth } from "@/context/AuthContext";
import { useMessageCache } from "@/context/MessageCacheContext";
import { supabase } from "@/lib/supabase";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/map", icon: Map, label: "Map" },
  { href: "/create", icon: PlusCircle, label: "Report" },
  { href: "/profile", icon: User, label: "Profile" },
];

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { conversations, setConversations, fetchConversations, clearUnread } = useMessageCache();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isVip = user?.is_vip === true;

  const isHidden =
    pathname.startsWith("/post/") || !!pathname.match(/^\/messages\/[^/]+$/);

  // Badge count from context — single source of truth
  const dmUnread = useMemo(() => {
    if (!isVip) return 0;
    return conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
  }, [conversations, isVip]);

  // Close menu on outside click
  useEffect(() => {
    if (isHidden) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    if (showProfileMenu) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showProfileMenu, isHidden]);

  // =====================================================
  // REALTIME — always active, even when nav is hidden
  // This is the proven working listener. It updates the
  // context so both badge AND messages list update instantly.
  // =====================================================
  useEffect(() => {
    if (!isVip || !user?.id) return;

    const channel = supabase
      .channel("dm-unread-nav")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as any;
          if (!msg.conversation_id) return;

          // Pre-cache the message so it's already there when chat opens
          try {
            const cacheKey = `peja-chat-cache-${msg.conversation_id}`;
            let messages: any[] = [];

            const cached = localStorage.getItem(cacheKey);
            if (cached) {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed)) messages = parsed;
            }

            if (!messages.find((m: any) => m.id === msg.id)) {
              messages.push({
                ...msg,
                media: [],
                delivery_status: msg.sender_id === user.id ? "sent" : undefined,
                read_at: null,
                hidden_for_me: false,
                reactions: [],
                reply_to: null,
              });
              localStorage.setItem(cacheKey, JSON.stringify(messages.slice(-100)));
            }
          } catch {}

          // Update context conversations INSTANTLY (optimistic)
          setConversations((prev) => {
            const isViewing =
              (window as any).__pejaActiveConversationId === msg.conversation_id;

            const updated = prev.map((c) => {
              if (c.id !== msg.conversation_id) return c;

              // Dedup: skip if we already processed this message
              if (
                c.last_message_at &&
                new Date(c.last_message_at).getTime() >= new Date(msg.created_at).getTime()
              ) {
                // Even if deduped, force unread to 0 if user is viewing
                if (isViewing && (c.unread_count || 0) > 0) {
                  return { ...c, unread_count: 0, last_message_seen: true };
                }
                return c;
              }

              const isFromOther = msg.sender_id !== user.id;

              return {
                ...c,
                last_message_text:
                  msg.content?.slice(0, 100) ||
                  (msg.content_type === "media" ? "Sent an attachment" : "New message"),
                last_message_at: msg.created_at,
                last_message_sender_id: msg.sender_id,
                last_message_seen: isViewing,
                updated_at: msg.created_at,
                unread_count: isViewing
                  ? 0
                  : isFromOther
                  ? (c.unread_count || 0) + 1
                  : c.unread_count,
              };
            });

            // Sort: most recent at top
            updated.sort((a, b) => {
              const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
              const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
              return bTime - aTime;
            });

            // Protect optimistic data from being overwritten by fetchConversations
            if (msg.sender_id !== user.id && (window as any).__pejaActiveConversationId !== msg.conversation_id) {
              const tracker = (window as any).__pejaUnreadProtect || {};
              const protConv = updated.find((c) => c.id === msg.conversation_id);
              if (protConv && protConv.unread_count > 0) {
                tracker[msg.conversation_id] = {
                  time: Date.now(),
                  unread: protConv.unread_count,
                  text: protConv.last_message_text,
                  messageAt: protConv.last_message_at,
                  senderId: protConv.last_message_sender_id,
                  seen: protConv.last_message_seen,
                };
                (window as any).__pejaUnreadProtect = tracker;
              }
            }

            return updated;
          });
        }
      )
            .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_participants",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as any;

          // When last_read_at is updated (user read a chat), just clear the badge.
          // Do NOT trigger a full fetchConversations — that causes race conditions
          // where stale DB data overwrites the optimistic clear.
          if (updated?.conversation_id) {
            clearUnread(updated.conversation_id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isVip, user?.id, setConversations, fetchConversations]);

  // =====================================================
  // ENFORCEMENT: Restore optimistic unreads after any
  // fetchConversations overwrites them. Runs whenever
  // conversations change from ANY source.
  // =====================================================
  useEffect(() => {
    const tracker = (window as any).__pejaUnreadProtect;
    if (!tracker || Object.keys(tracker).length === 0) return;

    const now = Date.now();
    let needsCorrection = false;

    // Check if any protected conversations were wiped
    for (const convId of Object.keys(tracker)) {
      const prot = tracker[convId];
      // Expire protection after 30 seconds
      if (now - prot.time > 30000) {
        delete tracker[convId];
        continue;
      }
      // Don't protect active conversation
      if ((window as any).__pejaActiveConversationId === convId) {
        delete tracker[convId];
        continue;
      }
      const conv = conversations.find((c) => c.id === convId);
      if (conv && (conv.unread_count || 0) < prot.unread) {
        needsCorrection = true;
        break;
      }
    }

    if (needsCorrection) {
      setConversations((prev) => {
        let changed = false;
        const restored = prev.map((c) => {
          const prot = tracker[c.id];
          if (!prot) return c;
          if ((c.unread_count || 0) < prot.unread) {
            changed = true;
            return {
              ...c,
              unread_count: prot.unread,
              last_message_text: prot.text,
              last_message_at: prot.messageAt,
              last_message_sender_id: prot.senderId,
              last_message_seen: prot.seen,
            };
          }
          return c;
        });
        return changed ? restored : prev;
      });
    }
  }, [conversations, setConversations]);

  // Now that all hooks have been called, we can return null
  if (isHidden) return null;

  const handleProfileClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isVip) {
      setShowProfileMenu((prev) => !prev);
    } else {
      router.push("/profile");
    }
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 glass-footer"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex items-center justify-around h-14 px-2">
        {navItems.slice(0, 2).map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          if (item.href === "/") {
            return (
              <button
                key={item.href}
                onClick={() => {
                  setShowProfileMenu(false);
                  if (pathname === "/") {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  } else {
                    router.push("/", { scroll: false });
                  }
                }}
                className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-colors ${
                  isActive ? "text-primary-400" : "text-dark-400 hover:text-dark-200"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs mt-1">{item.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              scroll={false}
              onClick={() => setShowProfileMenu(false)}
              className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-colors ${
                isActive ? "text-primary-400" : "text-dark-400 hover:text-dark-200"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs mt-1">{item.label}</span>
            </Link>
          );
        })}

        <div className="flex flex-col items-center justify-center -mt-8">
          <SOSButton />
          <span className="text-xs mt-1 text-red-400 font-medium">SOS</span>
        </div>

        <Link
          href="/create"
          scroll={false}
          onClick={() => setShowProfileMenu(false)}
          className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-colors ${
            pathname === "/create" ? "text-primary-400" : "text-dark-400 hover:text-dark-200"
          }`}
        >
          <PlusCircle className="w-5 h-5" />
          <span className="text-xs mt-1">Report</span>
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            onClick={handleProfileClick}
            className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-colors ${
              pathname === "/profile" || pathname === "/messages"
                ? "text-primary-400"
                : "text-dark-400 hover:text-dark-200"
            }`}
          >
            <div className="relative">
              {user?.avatar_url ? (
                <div
                  className={`w-6 h-6 rounded-full overflow-hidden border-2 ${
                    pathname === "/profile" || pathname === "/messages"
                      ? "border-primary-400"
                      : "border-transparent"
                  }`}
                >
                  <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <User className="w-5 h-5" />
              )}
              {isVip && dmUnread > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center bg-primary-600 text-white text-[10px] font-bold rounded-full px-1">
                  {dmUnread > 99 ? "99+" : dmUnread}
                </span>
              )}
            </div>
            <span className="text-xs mt-1">Profile</span>
          </button>

          {showProfileMenu && isVip && (
            <div className="profile-dropup fixed bottom-20 right-3 w-44 glass-strong rounded-xl overflow-hidden shadow-2xl border border-white/10 z-50">
              <button
                onClick={() => {
                  setShowProfileMenu(false);
                  router.push("/profile", { scroll: false });
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-white/5 ${
                  pathname === "/profile" ? "text-primary-400" : "text-dark-200"
                }`}
              >
                <User className="w-4 h-4" />
                Profile
              </button>
              <div className="h-px bg-white/5" />
              <button
                onClick={() => {
                  setShowProfileMenu(false);
                  router.push("/messages", { scroll: false });
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-white/5 ${
                  pathname === "/messages" ? "text-primary-400" : "text-dark-200"
                }`}
              >
                <MessageCircle className="w-4 h-4" />
                Messages
                {dmUnread > 0 && (
                  <span className="ml-auto min-w-[20px] h-[20px] flex items-center justify-center bg-primary-600 text-white text-[10px] font-bold rounded-full px-1">
                    {dmUnread > 99 ? "99+" : dmUnread}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}