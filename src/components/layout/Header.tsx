"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Menu, Plus, User, Search } from "lucide-react";
import { Button } from "../ui/Button";
import { useAuth } from "@/context/AuthContext";
import { getUnreadCount } from "@/lib/notifications";

interface HeaderProps {
  onMenuClick?: () => void;
  onCreateClick?: () => void;
}

export function Header({ onMenuClick, onCreateClick }: HeaderProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (user) {
      getUnreadCount(user.id).then(setUnreadCount);
      
      // Refresh count every 30 seconds
      const interval = setInterval(() => {
        getUnreadCount(user.id).then(setUnreadCount);
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [user]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass-header">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors lg:hidden"
          >
            <Menu className="w-5 h-5 text-dark-200" />
          </button>
          <Link href="/" className="flex items-center">
            <span className="text-2xl font-bold text-gradient">Peja</span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/search")}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Search className="w-5 h-5 text-dark-200" />
          </button>

          <Button
            variant="primary"
            size="sm"
            onClick={onCreateClick}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            <span className="hidden sm:inline">Report</span>
          </Button>

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

          <Link
            href="/profile"
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <User className="w-5 h-5 text-dark-200" />
          </Link>
        </div>
      </div>
    </header>
  );
}