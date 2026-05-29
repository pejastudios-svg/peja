"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { NotificationPopupListener } from "@/components/notifications/NotificationPopupListener";
import AdminPinGate from "@/components/admin/AdminPinGate";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

const navItems: { href: string; label: string; badge?: boolean }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/notifications", label: "Notifications", badge: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/posts", label: "Posts" },
  { href: "/admin/sos", label: "SOS Alerts" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/flagged", label: "Flagged" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/guardians", label: "Guardians" },
  { href: "/admin/vips", label: "VIPs" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/security", label: "Security" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();

  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const channelRef = useRef<any>(null);

  // Admin pages are always dark — isolate from user's theme preference.
  useEffect(() => {
    const prev = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", "dark");
    return () => {
      if (prev && prev !== "dark") {
        document.documentElement.setAttribute("data-theme", prev);
      }
    };
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { count, error } = await supabase
        .from("admin_notifications")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .eq("is_read", false);
      if (!error) setUnreadCount(count || 0);
    } catch {}
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    fetchUnreadCount();

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`admin-layout-badge-${user.id}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_notifications", filter: `recipient_id=eq.${user.id}` },
        () => fetchUnreadCount()
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, fetchUnreadCount]);

  useEffect(() => {
    const handleBadgeRefresh = () => fetchUnreadCount();
    window.addEventListener("admin-badge-refresh", handleBadgeRefresh);
    return () => window.removeEventListener("admin-badge-refresh", handleBadgeRefresh);
  }, [fetchUnreadCount]);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!user) {
        setChecking(false);
        return;
      }
      const { data } = await supabase
        .from("users")
        .select("is_admin")
        .eq("id", user.id)
        .single();
      if (!data?.is_admin) {
        router.push("/");
        return;
      }
      setIsAdmin(true);
      setChecking(false);
    };
    checkAdmin();
    // Depend on user?.id (stable string), not the user object — AuthContext
    // swaps that reference on token refresh / location writes, which was
    // re-running this admin check (an extra DB query) on every churn.
  }, [user?.id, router]);

  // Close the menu whenever the route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <PejaSpinner className="w-8 h-8" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-dark-100 mb-2">Access Denied</h1>
          <p className="text-dark-400 mb-4">You don't have permission to access this area.</p>
          <Link href="/" className="text-primary-400 hover:underline">Go back home</Link>
        </div>
      </div>
    );
  }

  // Normalise trailing slash (next.config has trailingSlash: true, so
  // usePathname can return "/admin/") before matching.
  const current = pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const isActive = (href: string) =>
    href === "/admin" ? current === "/admin" : current.startsWith(href);

  const pillSurface =
    "rounded-full bg-white/[0.04] backdrop-blur-2xl border border-white/[0.07] shadow-[0_8px_32px_-12px_rgba(0,0,0,0.6)]";

  const activeItem = navItems.find((i) => isActive(i.href));

  return (
    <AdminPinGate>
      <div className="min-h-screen admin-bg">
        <NotificationPopupListener
          table="admin_notifications"
          userColumn="recipient_id"
          onNotification={fetchUnreadCount}
        />

        {/* Full-width frosted scrim behind the pill. Kept tight to the nav so
            at rest the blur doesn't hang over the page below it; the mask
            fades out just past the pill's bottom edge. As content scrolls up
            it enters this zone from the transparent lower edge and fades into
            blur under the bar (mirrors the main app's HeaderBlurFade).
            Inset-aware for the native status bar. Behind the pill (z-40 <
            z-50), ignores pointer events. */}
        <div
          aria-hidden
          className="fixed top-0 left-0 right-0 z-40 pointer-events-none"
          style={{
            height: "calc(var(--app-top-inset, 0px) + 4.5rem)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            maskImage:
              "linear-gradient(to bottom, black 0%, black 75%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 0%, black 75%, transparent 100%)",
          }}
        />

        {/* ── Floating pill nav ───────────────────────────────── */}
        <header data-admin-nav className="fixed left-1/2 -translate-x-1/2 z-50 w-auto max-w-[calc(100vw-1.5rem)]">
          {/* Wide: full inline pill */}
          <div className={`hidden xl:block ${pillSurface} px-1.5 py-1`}>
            <nav className="flex items-center gap-0.5">
              {navItems.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative px-3.5 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${
                      active ? "text-primary-400" : "text-dark-300 hover:text-white"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {item.label}
                      {item.badge && unreadCount > 0 && (
                        <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </span>
                    {active && (
                      <span className="absolute left-3.5 right-3.5 bottom-1 h-[2px] bg-primary-400 rounded-full" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Narrow: compact pill with current section + hamburger */}
          <div className="xl:hidden relative">
            <div className={`${pillSurface} flex items-center gap-1 pl-4 pr-1.5 py-1`}>
              <span className="text-[13px] font-medium text-primary-400 whitespace-nowrap inline-flex items-center gap-1.5">
                {activeItem?.label ?? "Menu"}
                {activeItem?.badge && unreadCount > 0 && (
                  <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </span>
              <button
                type="button"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors"
              >
                <span
                  className={`absolute block h-[2px] w-5 bg-white rounded-full transition-all duration-300 ease-out ${
                    menuOpen ? "rotate-45 translate-y-0" : "-translate-y-[4px]"
                  }`}
                />
                <span
                  className={`absolute block h-[2px] w-5 bg-white rounded-full transition-all duration-300 ease-out ${
                    menuOpen ? "-rotate-45 translate-y-0" : "translate-y-[4px]"
                  }`}
                />
              </button>
            </div>

            {/* Dropdown panel */}
            <div
              className={`absolute top-full mt-2 left-1/2 -translate-x-1/2 w-[min(20rem,calc(100vw-1.5rem))] origin-top transition-all duration-200 ease-out ${
                menuOpen ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"
              }`}
            >
              <nav className="rounded-3xl bg-dark-950/95 backdrop-blur-2xl border border-white/[0.07] shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)] p-2 grid grid-cols-2 gap-1">
                {navItems.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${
                        active ? "text-primary-400 bg-primary-500/10" : "text-dark-200 hover:bg-white/5"
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.badge && unreadCount > 0 && (
                        <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </header>

        {/* Tap-away backdrop while the dropdown is open */}
        {menuOpen && (
          <div className="xl:hidden fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
        )}

        <main className="min-h-screen">{children}</main>
      </div>
    </AdminPinGate>
  );
}
