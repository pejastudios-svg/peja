"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Home, Map, PlusCircle, Search } from "lucide-react";
import { SOSButton } from "../sos/SOSButton";
import { useAuth } from "@/context/AuthContext";
import { SMLButton } from "../safety/SMLButton";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/map", icon: Map, label: "Map" },
  { href: "/create", icon: PlusCircle, label: "Report" },
  { href: "/search", icon: Search, label: "Search" },
];

const GLASS: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(30, 20, 50, 0.55) 0%, rgba(20, 15, 40, 0.65) 100%)",
  backdropFilter: "blur(40px) saturate(200%)",
  WebkitBackdropFilter: "blur(40px) saturate(200%)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  boxShadow:
    "0 4px 24px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 -1px 0 rgba(0, 0, 0, 0.2) inset",
  transform: "translateZ(0)",
  WebkitTransform: "translateZ(0)",
  willChange: "backdrop-filter",
};
const GLASS_SOS: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(80, 20, 25, 0.55) 0%, rgba(60, 15, 20, 0.65) 100%)",
  backdropFilter: "blur(40px) saturate(200%)",
  WebkitBackdropFilter: "blur(40px) saturate(200%)",
  border: "1px solid rgba(239, 68, 68, 0.18)",
  boxShadow:
    "0 4px 24px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 0 15px rgba(239, 68, 68, 0.08)",
  transform: "translateZ(0)",
  WebkitTransform: "translateZ(0)",
  willChange: "backdrop-filter",
};

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  // Scroll-to-minimize state
  const [minimized, setMinimized] = useState(false);
  const lastScrollY = useRef(0);
  const scrollAccum = useRef(0);

  const isHidden =
    pathname.startsWith("/post/") || !!pathname.match(/^\/messages\/[^/]+$/);

const activeIndex = useMemo(() => {
    if (pathname === "/" || pathname === "") return 0;
    if (pathname.startsWith("/map")) return 1;
    if (pathname.startsWith("/create")) return 2;
    if (pathname.startsWith("/search")) return 3;
    return -1;
  }, [pathname]);

  // Sliding indicator position
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    const el = itemRefs.current[activeIndex];
    const nav = navRef.current;
    if (el && nav) {
      const navRect = nav.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setIndicatorStyle({
        left: elRect.left - navRect.left + (elRect.width - 40) / 2,
        width: 40,
      });
    }
  }, [activeIndex]);

  useEffect(() => {
    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [updateIndicator]);

  useEffect(() => {
    const timer = setTimeout(updateIndicator, 80);
    return () => clearTimeout(timer);
  }, [pathname, updateIndicator]);

  // Scroll detection for minimize/expand
  useEffect(() => {
    if (isHidden) return;

    const THRESHOLD_DOWN = 40; // px scrolled down to minimize
    const THRESHOLD_UP = 20; // px scrolled up to expand

    const handleScroll = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY.current;

      if (delta > 0) {
        // Scrolling down
        scrollAccum.current += delta;
        if (scrollAccum.current > THRESHOLD_DOWN && currentY > 100) {
          setMinimized(true);
          scrollAccum.current = 0;
        }
      } else {
        // Scrolling up
        scrollAccum.current += delta; // delta is negative
        if (scrollAccum.current < -THRESHOLD_UP) {
          setMinimized(false);
          scrollAccum.current = 0;
        }
      }

      // Always expand at top of page
      if (currentY < 50) {
        setMinimized(false);
        scrollAccum.current = 0;
      }

      lastScrollY.current = currentY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isHidden]);

  // Reset minimized when navigating
  useEffect(() => {
    setMinimized(false);
    scrollAccum.current = 0;
  }, [pathname]);

  // All hooks above — safe to return null
  if (isHidden) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 transition-all"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        transition: "transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      <div className="px-3 pb-2">
        {/* ── Minimized state: just a Home pill ── */}
        <div
          className="flex items-center justify-center"
          style={{
            position: "absolute",
            bottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
            left: "50%",
            transform: `translateX(-50%) scale(${minimized ? 1 : 0.8})`,
            opacity: minimized ? 1 : 0.01,
            pointerEvents: minimized ? "auto" : "none",
            transition:
              "opacity 0.3s cubic-bezier(0.32, 0.72, 0, 1), transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          <button
            onClick={() => {
              if (pathname === "/") {
                window.scrollTo({ top: 0, behavior: "smooth" });
              } else {
                router.push("/", { scroll: false });
              }
              setMinimized(false);
            }}
            className="flex items-center justify-center w-12 h-12"
            style={{
              ...GLASS,
              borderRadius: "16px",
            }}
          >
            <Home
              className="w-6 h-6"
              style={{
                color: "#c4b5fd",
                filter: "drop-shadow(0 0 6px rgba(167,139,250,0.5))",
              }}
              strokeWidth={2.4}
            />
          </button>
        </div>

        {/* ── Full nav ── */}
        <div
          className="flex items-center gap-2"
           style={{
            opacity: minimized ? 0.01 : 1,
            pointerEvents: minimized ? "none" : "auto",
            transition: "opacity 0.3s ease",
          }}
        >
          {/* ── Nav pill (75%) ── */}
          <div
            ref={navRef}
            className="relative flex items-center justify-around h-14"
style={{
              ...GLASS,
              borderRadius: "20px",
              flex: "3",
            }}
          >

            {navItems.map((item, index) => {
              const isActive = index === activeIndex;
              const Icon = item.icon;

              const inner = (
                <>
                  <Icon
                    className="w-[22px] h-[22px] transition-all duration-300"
                    style={{
                      color: isActive ? "#c4b5fd" : "rgba(255,255,255,0.55)",
                      filter: isActive
                        ? "drop-shadow(0 0 6px rgba(167,139,250,0.4))"
                        : "none",
                    }}
                    strokeWidth={2.5}
                  />
                  <span
                    className="text-[10px] mt-0.5 font-semibold transition-all duration-300"
                    style={{
                    color: isActive ? "#c4b5fd" : "rgba(255,255,255,0.45)",
                    }}
                  >
                    {item.label}
                  </span>
                </>
              );

              if (item.href === "/") {
                return (
                  <button
                    key={item.href}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    onClick={() => {
                      if (pathname === "/") {
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      } else {
                        router.push("/", { scroll: false });
                      }
                    }}
                    className="relative z-10 flex flex-col items-center justify-center py-1.5 px-3"
                  >
                    {inner}
                  </button>
                );
              }

return (
                <Link
                  key={item.href}
                  href={item.href}
                  scroll={false}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  data-tutorial={
                    item.href === "/map" ? "nav-map" :
                    item.href === "/create" ? "nav-report" :
                    item.href === "/search" ? "nav-search" :
                    undefined
                  }
                  className="relative z-10 flex flex-col items-center justify-center py-1.5 px-3"
                >
                  {inner}
                </Link>
              );
            })}
          </div>

{/* ── SOS + SML ── */}
          <div
            className="flex flex-col items-center gap-2"
            style={{
              flex: "0",
              position: "absolute",
              right: 16,
              bottom: "calc(100% + 12px)",
            }}
          >
            <SMLButton />
<div
              data-tutorial="nav-sos"
              className="flex items-center justify-center"
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "rgba(60, 25, 30, 0.45)",
                backdropFilter: "blur(40px) saturate(180%)",
                WebkitBackdropFilter: "blur(40px) saturate(180%)",
                border: "1px solid rgba(239, 68, 68, 0.15)",
                boxShadow: "0 2px 20px rgba(0, 0, 0, 0.3), inset 0 0.5px 0 rgba(255, 255, 255, 0.08)",
              }}
            >
              <SOSButton className="w-9 h-9" />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
