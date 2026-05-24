"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Home, Map, PlusCircle, Search } from "lucide-react";
import { SOSButton } from "../sos/SOSButton";
import { useAuth } from "@/context/AuthContext";
import { SMLButton } from "../safety/SMLButton";
import { buildLoginHref } from "@/lib/safeNext";

const PEJA_LOGO = "https://plastic-lime-elzghqehop.edgeone.app/peja%20logo%20SINGLE.png";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/map", icon: Map, label: "Map" },
  { href: "/create", icon: PlusCircle, label: "Report" },
  { href: "/search", icon: Search, label: "Search" },
];

const GLASS: React.CSSProperties = {
  background: "var(--glass-footer-bg)",
  backdropFilter: "blur(40px) saturate(180%)",
  WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid var(--glass-border)",
  boxShadow: "var(--glass-shadow-footer)",
};

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);

  const [sosActive, setSosActive] = useState(false);
  const [smlActive, setSmlActive] = useState(false);
  const [smlSharedCount, setSmlSharedCount] = useState(0);
  const [smlOverdue, setSmlOverdue] = useState(false);

  const closeMenu = useCallback(() => {
    setMenuClosing(true);
    setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 300);
  }, []);

  // BottomNav is allowlist-only: just the Home and Search pages. Every
  // other route (Map, Notifications, Create, Post detail, Chat detail,
  // Profile, Settings, etc.) renders without it.
  const isHidden = !(pathname === "/" || pathname.startsWith("/search"));

  const activeIndex = useMemo(() => {
    if (pathname === "/" || pathname === "") return 0;
    if (pathname.startsWith("/map")) return 1;
    if (pathname.startsWith("/create")) return 2;
    if (pathname.startsWith("/search")) return 3;
    return -1;
  }, [pathname]);

  // Floating pill indicator — left + width of the active item so the
  // pill fluidly resizes and slides between tabs (Slack-style).
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const updateIndicator = useCallback(() => {
    const el = itemRefs.current[activeIndex];
    const nav = navRef.current;
    if (el && nav) {
      const navRect = nav.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      setIndicator({
        left: elRect.left - navRect.left,
        width: elRect.width,
      });
    } else {
      setIndicator(null);
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

  useEffect(() => {
    if (menuOpen) closeMenu();
  }, [pathname]);

    // Tutorial control for Peja menu
  useEffect(() => {
    const handleOpen = () => setMenuOpen(true);
    const handleClose = () => setMenuOpen(false);
    window.addEventListener("peja-tutorial-open-menu", handleOpen);
    window.addEventListener("peja-tutorial-close-menu", handleClose);
    return () => {
      window.removeEventListener("peja-tutorial-open-menu", handleOpen);
      window.removeEventListener("peja-tutorial-close-menu", handleClose);
    };
  }, []);

  // Listen for SOS/SML state changes
  useEffect(() => {
    const handleSOS = (e: any) => setSosActive(e.detail?.active || false);
    const handleSML = (e: any) => {
      setSmlActive(e.detail?.active || false);
      setSmlSharedCount(e.detail?.sharedCount || 0);
      setSmlOverdue(e.detail?.isOverdue || false);
    };
    window.addEventListener("peja-sos-state", handleSOS);
    window.addEventListener("peja-sml-state", handleSML);

    // Init from localStorage
    const savedSOS = localStorage.getItem("peja-sos-active-id");
    if (savedSOS) setSosActive(true);
    const savedSML = localStorage.getItem("peja-sml-active");
    if (savedSML) {
      setSmlActive(true);
      try {
        const checkin = JSON.parse(savedSML);
        if (checkin?.next_check_in_at && new Date(checkin.next_check_in_at).getTime() < Date.now()) {
          setSmlOverdue(true);
        }
      } catch {}
    }
    try {
      const savedShared = localStorage.getItem("peja-sml-shared");
      if (savedShared) setSmlSharedCount(JSON.parse(savedShared).length);
    } catch {}

    return () => {
      window.removeEventListener("peja-sos-state", handleSOS);
      window.removeEventListener("peja-sml-state", handleSML);
    };
  }, []);

  useScrollFreeze(menuOpen || menuClosing);

  if (isHidden) return null;

  const renderNavItem = (item: typeof navItems[0], index: number) => {
    const isActive = index === activeIndex;
    const Icon = item.icon;

    const inner = (
      <div className="relative z-10 flex flex-col items-center justify-center py-1.5">
        <div
          style={{
            transition: "all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
            transform: isActive ? "translateY(-3px)" : "translateY(0)",
          }}
        >
          <Icon
            className="w-[22px] h-[22px]"
            style={{
              color: isActive ? "var(--color-primary-600)" : "var(--color-dark-400)",
              filter: isActive ? "drop-shadow(0 0 6px rgba(167,139,250,0.5))" : "none",
              transition: "all 0.3s ease",
            }}
            strokeWidth={isActive ? 2.8 : 2.2}
          />
        </div>
        <span
          className="text-[10px] mt-0.5 font-semibold"
          style={{
            color: isActive ? "var(--color-primary-600)" : "var(--color-dark-500)",
            transition: "color 0.3s ease",
          }}
        >
          {item.label}
        </span>
      </div>
    );

    if (item.href === "/") {
      return (
        <button
          key={item.href}
          ref={(el) => { itemRefs.current[index] = el; }}
          onClick={() => {
            if (pathname === "/") window.scrollTo({ top: 0, behavior: "smooth" });
            else router.push("/", { scroll: false });
          }}
          className="flex-1 flex items-center justify-center"
        >
          {inner}
        </button>
      );
    }

    if (item.href === "/create" && !user) {
      return (
        <button
          key={item.href}
          ref={(el) => { itemRefs.current[index] = el; }}
          data-tutorial="nav-report"
          className="flex-1 flex items-center justify-center"
          onClick={() => {
            router.push(buildLoginHref("/create", "/login"), { scroll: false });
          }}
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
        ref={(el) => { itemRefs.current[index] = el; }}
        data-tutorial={
          item.href === "/map" ? "nav-map" :
          item.href === "/create" ? "nav-report" :
          item.href === "/search" ? "nav-search" :
          undefined
        }
        className="flex-1 flex items-center justify-center"
      >
        {inner}
      </Link>
    );
  };

  return (
    <>
      {/* Menu backdrop */}
      {(menuOpen || menuClosing) && (
        <div
          className="fixed inset-0 z-[49] bg-black/40"
          style={{
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            animation: menuClosing ? "fadeOut 0.25s ease forwards" : "fadeIn 0.2s ease",
          }}
          onClick={closeMenu}
        />
      )}

      <nav
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="px-4 pb-2 relative">

          {/* ── Full nav ── */}
          <div>
            <div
              ref={navRef}
              className="relative flex items-center h-[60px]"
              style={{ ...GLASS, borderRadius: "9999px" }}
            >
              {/* Sliding active pill — fills the active item with a soft
                  primary tint and animates between tabs. Sits BEHIND the
                  icon/label (z 0) which render at z 10. */}
              {indicator && activeIndex >= 0 && (() => {
                // Per-side inset. Leftmost (Home) and rightmost (Search)
                // each pull 3px closer to the matching nav edge so the
                // pill doesn't sit offset against the rounded corner.
                // Middle items keep the symmetric 4px each side.
                const leftInset = activeIndex === 0 ? 1 : 4;
                const rightInset = activeIndex === 3 ? 1 : 4;
                return (
                  <div
                    aria-hidden
                    className="absolute pointer-events-none"
                    style={{
                      left: indicator.left + leftInset,
                      width: indicator.width - leftInset - rightInset,
                      top: 2,
                      bottom: 2,
                      borderRadius: "9999px",
                      background: "rgba(167, 139, 250, 0.18)",
                      border: "1px solid rgba(167, 139, 250, 0.28)",
                      transition:
                        "left 0.35s cubic-bezier(0.4, 0.0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0.0, 0.2, 1)",
                      zIndex: 0,
                    }}
                  />
                );
              })()}

              {/* Left items: Home, Map */}
              {renderNavItem(navItems[0], 0)}
              {renderNavItem(navItems[1], 1)}

              {/* Center spacer for logo */}
              <div className="w-[68px] shrink-0" />

              {/* Right items: Report, Search */}
              {renderNavItem(navItems[2], 2)}
              {renderNavItem(navItems[3], 3)}
            </div>

            {/* ── Center Peja Logo + SOS/SML fan ── */}
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{ bottom: 18, zIndex: 60 }}
            >
              {/* Fan-out: SML (left) */}
              <div
                data-tutorial="nav-sml"
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: "100%",
                  transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  transform: menuOpen && !menuClosing
                    ? "translate(calc(-50% - 32px), -16px) scale(1)"
                    : "translate(-50%, 20px) scale(0)",
                  opacity: menuOpen && !menuClosing ? 1 : 0,
                  pointerEvents: menuOpen && !menuClosing ? "auto" : "none",
                }}
              >
                <div className="flex flex-col items-center gap-1">
                  <SMLButton />
                  <span className="text-[9px] font-bold text-primary-300 uppercase tracking-wider">SML</span>
                </div>
              </div>

            {/* Fan-out: SOS (right) */}
              <div
                data-tutorial="nav-sos"
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: "100%",
                  transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.04s",
                  transform: menuOpen && !menuClosing
                    ? "translate(calc(-50% + 32px), -16px) scale(1)"
                    : "translate(-50%, 20px) scale(0)",
                  opacity: menuOpen && !menuClosing ? 1 : 0,
                  pointerEvents: menuOpen ? "auto" : "none",
                }}
              >
                <div className="flex flex-col items-center gap-1">
                  <div
                    className="flex items-center justify-center"
                    style={{ width: 48, height: 48 }}
                  >
                    <SOSButton className="w-full h-full" />
                  </div>
                  <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider">SOS</span>
                </div>
              </div>

              {/* Peja logo button */}
              <button
               onClick={() => {
                  if (!user) {
                    router.push("/login");
                    return;
                  }
                  if (menuOpen || menuClosing) {
                    closeMenu();
                  } else {
                    setMenuOpen(true);
                  }
                }}
                className="relative flex items-center justify-center peja-center-btn"
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: "50%",
                  background: menuOpen && !menuClosing
                    ? "var(--peja-btn-pressed-bg)"
                    : "var(--peja-btn-bg)",
                  backdropFilter: "blur(40px) saturate(180%)",
                  WebkitBackdropFilter: "blur(40px) saturate(180%)",
                  border: `2px solid ${
                    menuOpen && !menuClosing
                      ? "var(--peja-btn-pressed-bg)"
                      : sosActive || smlActive
                        ? "transparent"
                        : "var(--peja-btn-outline, rgba(139, 92, 246, 0.5))"
                  }`,
                  boxShadow: menuOpen && !menuClosing
                    ? "0 0 30px rgba(139, 92, 246, 0.35), 0 4px 20px rgba(0, 0, 0, 0.4)"
                    : "0 0 15px rgba(139, 92, 246, 0.12), 0 4px 16px rgba(0, 0, 0, 0.3)",
                  animation: (() => {
                    if (menuOpen) return "none";
                    const redActive = sosActive || smlOverdue;
                    const greenActive = smlActive && !smlOverdue;
                    if (redActive && greenActive) return "peja-pulse-dual 3s ease-in-out infinite";
                    if (redActive) return "peja-pulse-red 1.5s ease-in-out infinite";
                    if (greenActive) return "peja-pulse-green 1.5s ease-in-out infinite";
                    return "none";
                  })(),
                  transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  transform: menuOpen && !menuClosing ? "scale(0.88) rotate(45deg)" : "scale(1) rotate(0deg)",
                  zIndex: 40,
                }}
              >
                <img
                  src={PEJA_LOGO}
                  alt="Peja"
                  className="w-8 h-8 object-contain"
                  style={{
                    filter: "drop-shadow(0 0 3px rgba(167, 139, 250, 0.3))",
                    transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                    transform: menuOpen && !menuClosing ? "rotate(-45deg)" : "rotate(0deg)",
                  }}
                />
                {/* Shared count badge */}
                {smlSharedCount > 0 && !menuOpen && (
                  <div
                    className="absolute -top-1 -right-1 flex items-center justify-center"
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "#22c55e",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "white",
                      boxShadow: "0 0 6px rgba(34, 197, 94, 0.5)",
                    }}
                  >
                    {smlSharedCount}
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}