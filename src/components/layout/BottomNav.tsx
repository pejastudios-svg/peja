"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Home, Map, PlusCircle, Radio, Search } from "lucide-react";
import { SOSButton } from "../sos/SOSButton";
import { useAuth } from "@/context/AuthContext";
import { SMLButton } from "../safety/SMLButton";
import { buildLoginHref } from "@/lib/safeNext";
import { canUseBeacon } from "@/lib/beacon";

// Bundled local asset (public/peja-logo.png.png) — the older
// edgeone CDN URL didn't render offline and made the center BottomNav
// button look broken on no-network reloads. Serving locally means
// the service worker caches it with the rest of the static assets
// and it survives offline.
const PEJA_LOGO = "/peja-logo.png.png";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/map", icon: Map, label: "Map" },
  { href: "/create", icon: PlusCircle, label: "Report" },
  { href: "/search", icon: Search, label: "Search" },
];

// Opaque, no backdrop-filter. A blur(40px) on a fixed bar was the heaviest
// compositing trigger in the app and stamped black tiles onto the scrolling
// content on some Android GPUs. --glass-footer-bg is now a solid colour.
const GLASS: React.CSSProperties = {
  background: "var(--glass-footer-bg)",
  border: "1px solid var(--glass-border)",
  boxShadow: "var(--glass-shadow-footer)",
};

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  // Separate refs to the icon SVGs themselves — the active-tab line
  // measures from these so it lines up with the icon, not with the
  // (wider) item column.
  const iconRefs = useRef<(SVGSVGElement | null)[]>([]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);

  const [sosActive, setSosActive] = useState(false);
  const [smlActive, setSmlActive] = useState(false);
  const [smlSharedCount, setSmlSharedCount] = useState(0);
  const [smlOverdue, setSmlOverdue] = useState(false);
  // Flips to true if the Peja logo <img> ever errors. We render a
  // styled "P" mark in its place — so a transient asset failure (which
  // is what we suspect is happening during the keyboard-hide repaint)
  // shows a Peja-branded fallback instead of whatever the WebView
  // would otherwise paint there.
  const [logoBroken, setLogoBroken] = useState(false);

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
    // Measure the icon SVG so the line tracks the icon, not the
    // wider item column. Falls back to the item bounds if the icon
    // ref hasn't mounted yet (first paint, hot reload).
    const iconEl = iconRefs.current[activeIndex];
    const itemEl = itemRefs.current[activeIndex];
    const nav = navRef.current;
    if (!nav) {
      setIndicator(null);
      return;
    }
    const targetEl = iconEl ?? itemEl;
    if (!targetEl) {
      setIndicator(null);
      return;
    }
    const navRect = nav.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    setIndicator({
      left: targetRect.left - navRect.left,
      width: targetRect.width,
    });
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
            ref={(el: SVGSVGElement | null) => { iconRefs.current[index] = el; }}
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
                // Short active-tab line, centered over the icon. ~28px
                // wide — close to the icon glyph itself — so it reads
                // as "this tab" rather than "this whole column".
                const LINE_WIDTH = 28;
                return (
                  <div
                    aria-hidden
                    className="absolute pointer-events-none"
                    style={{
                      left: indicator.left + indicator.width / 2 - LINE_WIDTH / 2,
                      width: LINE_WIDTH,
                      top: 0,
                      height: 3,
                      borderRadius: "9999px",
                      background: "var(--color-primary-600)",
                      transition:
                        "left 0.35s cubic-bezier(0.4, 0.0, 0.2, 1)",
                      zIndex: 20,
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

            {/* Fan-out: Beacon (top center) — closed pilot, gated by email */}
              {canUseBeacon(user?.email) && (
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "100%",
                    zIndex: 2,
                    transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.08s",
                    transform: menuOpen && !menuClosing
                      ? "translate(-50%, -96px) scale(1)"
                      : "translate(-50%, 20px) scale(0)",
                    opacity: menuOpen && !menuClosing ? 1 : 0,
                    pointerEvents: menuOpen && !menuClosing ? "auto" : "none",
                  }}
                >
                  <div className="flex flex-col items-center gap-1">
                    <button
                      onClick={() => {
                        closeMenu();
                        router.push("/beacon");
                      }}
                      aria-label="Beacon"
                      className="w-12 h-12 rounded-full bg-primary-600 border-2 border-primary-400/60 shadow-lg shadow-primary-900/40 flex items-center justify-center active:scale-90 transition-transform"
                    >
                      <Radio className="w-5.5 h-5.5 text-white" />
                    </button>
                    <span className="beacon-accent-text text-[9px] font-bold uppercase tracking-wider">Beacon</span>
                  </div>
                </div>
              )}

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
                {logoBroken ? (
                  <div
                    className="w-8 h-8 flex items-center justify-center"
                    style={{
                      borderRadius: "50%",
                      background:
                        "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                      color: "#ffffff",
                      fontWeight: 800,
                      fontSize: 16,
                      letterSpacing: "0.5px",
                      filter:
                        "drop-shadow(0 0 3px rgba(167, 139, 250, 0.3))",
                      transition:
                        "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                      transform:
                        menuOpen && !menuClosing
                          ? "rotate(-45deg)"
                          : "rotate(0deg)",
                    }}
                  >
                    P
                  </div>
                ) : (
                  <img
                    src={PEJA_LOGO}
                    alt="Peja"
                    className="w-8 h-8 object-contain"
                    decoding="async"
                    onError={() => setLogoBroken(true)}
                    style={{
                      filter: "drop-shadow(0 0 3px rgba(167, 139, 250, 0.3))",
                      transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                      transform: menuOpen && !menuClosing ? "rotate(-45deg)" : "rotate(0deg)",
                    }}
                  />
                )}
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