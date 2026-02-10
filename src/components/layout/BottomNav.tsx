"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Home, Map, Bell, User, Plus, PlusCircle } from "lucide-react";
import { SOSButton } from "../sos/SOSButton";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/map", icon: Map, label: "Map" },
  { href: "/create", icon: PlusCircle, label: "Report" },
  { href: "/profile", icon: User, label: "Profile" },
];

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();

  // Don't show on post detail page (has its own fixed input)
  if (pathname.startsWith("/post/")) return null;

  return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 glass-footer safe-bottom" style={{ paddingBottom: "var(--cap-bottom-inset, env(safe-area-inset-bottom, 0px))" }}>
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.slice(0, 2).map((item) => {
  const isActive = pathname === item.href;
  const Icon = item.icon;

  if (item.href === "/") {
                return (
                  <button
                    key={item.href}
                    onClick={() => {
                      if (pathname === "/") {
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      } else {
                        router.push("/");
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
      className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-colors ${
        isActive ? "text-primary-400" : "text-dark-400 hover:text-dark-200"
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
              scroll={false}
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