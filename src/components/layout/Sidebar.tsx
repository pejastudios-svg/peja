"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Home,
  Map,
  TrendingUp,
  Bell,
  Settings,
  Shield,
  HelpCircle,
  Search,
  X,
  LayoutDashboard,
  Users,
} from "lucide-react";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const menuItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/search", icon: Search, label: "Search" },
  { href: "/map", icon: Map, label: "Map View" },
  { href: "/notifications", icon: Bell, label: "Notifications" },
];

const secondaryItems = [
  { href: "/settings", icon: Settings, label: "Settings" },
  { href: "/become-guardian", icon: Shield, label: "Become a Guardian" },
  { href: "/help", icon: HelpCircle, label: "Help & Support" },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isGuardian, setIsGuardian] = useState(false);

  useEffect(() => {
    if (user) {
      checkRoles();
    }
  }, [user]);

  const checkRoles = async () => {
    if (!user) return;

    try {
      const { data } = await supabase
        .from("users")
        .select("is_admin, is_guardian")
        .eq("id", user.id)
        .single();

      if (data) {
        setIsAdmin(data.is_admin || false);
        setIsGuardian(data.is_guardian || false);
      }
    } catch (error) {
    }
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 bottom-0 w-64 glass border-r border-white/5 z-50 transform transition-transform duration-300 lg:translate-x-0 lg:top-16 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 lg:hidden">
          <span className="text-lg font-bold text-gradient">Peja</span>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg"
          >
            <X className="w-5 h-5 text-dark-400" />
          </button>
        </div>

        <nav className="p-4">
          <div className="space-y-1">
            {menuItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                    isActive
                      ? "bg-primary-600/20 text-primary-400 border border-primary-500/30"
                      : "text-dark-300 hover:bg-white/5 hover:text-dark-100"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Admin & Guardian Links */}
          {(isAdmin || isGuardian) && (
            <div className="mt-6 pt-4 border-t border-white/5">
              <p className="px-3 text-xs font-medium text-dark-500 uppercase tracking-wider mb-2">
                Management
              </p>
              <div className="space-y-1">
                {isAdmin && (
                  <Link
                    href="/admin"
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                      pathname.startsWith("/admin")
                        ? "bg-red-600/20 text-red-400 border border-red-500/30"
                        : "text-dark-300 hover:bg-white/5 hover:text-dark-100"
                    }`}
                  >
                    <LayoutDashboard className="w-5 h-5" />
                    <span className="font-medium">Admin Dashboard</span>
                  </Link>
                )}
                {isGuardian && (
                  <Link
                    href="/guardian"
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                      pathname.startsWith("/guardian")
                        ? "bg-primary-600/20 text-primary-400 border border-primary-500/30"
                        : "text-dark-300 hover:bg-white/5 hover:text-dark-100"
                    }`}
                  >
                    <Shield className="w-5 h-5" />
                    <span className="font-medium">Guardian Hub</span>
                  </Link>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-white/5">
            <p className="px-3 text-xs font-medium text-dark-500 uppercase tracking-wider mb-2">
              More
            </p>
            <div className="space-y-1">
              {secondaryItems.map((item) => {
                const Icon = item.icon;
                // Hide "Become a Guardian" if already a guardian
                if (item.href === "/become-guardian" && isGuardian) {
                  return null;
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-dark-400 hover:bg-white/5 hover:text-dark-200 transition-colors"
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      </aside>
    </>
  );
}