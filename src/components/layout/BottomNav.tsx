"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Home, Map, PlusCircle, User, MessageCircle } from "lucide-react";
import { SOSButton } from "../sos/SOSButton";
import { useAuth } from "@/context/AuthContext";
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
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [dmUnread, setDmUnread] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const isVip = user?.is_vip === true;

  // Don't show on post detail page or inside DM chat
  if (pathname.startsWith("/post/")) return null;
  if (pathname.match(/^\/messages\/[^/]+$/)) return null;

  // Close menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    if (showProfileMenu) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showProfileMenu]);

  // Fetch DM unread count for VIPs
  useEffect(() => {
    if (!isVip || !user?.id) return;

    const fetchUnread = async () => {
      try {
        // Get all conversations user is in
        const { data: participations } = await supabase
          .from("conversation_participants")
          .select("conversation_id, last_read_at")
          .eq("user_id", user.id);

        if (!participations || participations.length === 0) {
          setDmUnread(0);
          return;
        }

        let total = 0;
        for (const p of participations) {
          const { count } = await supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("conversation_id", p.conversation_id)
            .neq("sender_id", user.id)
            .gt("created_at", p.last_read_at || "1970-01-01");

          total += count || 0;
        }

        setDmUnread(total);
      } catch {
        setDmUnread(0);
      }
    };

    fetchUnread();

    // Listen for new messages
    const channel = supabase
      .channel("dm-unread-nav")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => fetchUnread()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_participants", filter: `user_id=eq.${user.id}` },
        () => fetchUnread()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isVip, user?.id]);

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
      className="fixed bottom-0 left-0 right-0 z-50 glass-footer safe-bottom"
      style={{
        paddingBottom:
          "var(--cap-bottom-inset, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="flex items-center justify-around h-16 px-2">
        {/* Home & Map */}
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
                  isActive
                    ? "text-primary-400"
                    : "text-dark-400 hover:text-dark-200"
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
                isActive
                  ? "text-primary-400"
                  : "text-dark-400 hover:text-dark-200"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs mt-1">{item.label}</span>
            </Link>
          );
        })}

        {/* SOS Button in center */}
        <div className="flex flex-col items-center justify-center -mt-8">
          <SOSButton />
          <span className="text-xs mt-1 text-red-400 font-medium">SOS</span>
        </div>

        {/* Report */}
        <Link
          href="/create"
          scroll={false}
          onClick={() => setShowProfileMenu(false)}
          className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-colors ${
            pathname === "/create"
              ? "text-primary-400"
              : "text-dark-400 hover:text-dark-200"
          }`}
        >
          <PlusCircle className="w-5 h-5" />
          <span className="text-xs mt-1">Report</span>
        </Link>

        {/* Profile (with drop-up for VIPs) */}
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
              <User className="w-5 h-5" />
              {isVip && dmUnread > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center bg-primary-600 text-white text-[10px] font-bold rounded-full px-1">
                  {dmUnread > 99 ? "99+" : dmUnread}
                </span>
              )}
            </div>
            <span className="text-xs mt-1">Profile</span>
          </button>

          {/* VIP Drop-up Menu */}
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