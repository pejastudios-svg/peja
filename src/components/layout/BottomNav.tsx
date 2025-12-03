"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Map, Bell, User } from "lucide-react";
import { SOSButton } from "../sos/SOSButton";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/map", icon: Map, label: "Map" },
  { href: "/notifications", icon: Bell, label: "Alerts" },
  { href: "/profile", icon: User, label: "Profile" },
];

export function BottomNav() {
  const pathname = usePathname();

  // Don't show on post detail page (has its own fixed input)
  if (pathname.startsWith("/post/")) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass-footer lg:hidden safe-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.slice(0, 2).map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
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

        {navItems.slice(2).map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
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
      </div>
    </nav>
  );
}