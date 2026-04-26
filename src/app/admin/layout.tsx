"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { NotificationPopupListener } from "@/components/notifications/NotificationPopupListener";
import AdminPinGate from "@/components/admin/AdminPinGate";
import { LogOut } from "lucide-react";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

const navItems: { href: string; label: string; badge?: boolean }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/notifications", label: "Notifications", badge: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/posts", label: "Posts" },
  { href: "/admin/sos", label: "SOS Alerts" },
  { href: "/admin/flagged", label: "Flagged" },
  { href: "/admin/guardians", label: "Guardians" },
  { href: "/admin/vips", label: "VIPs" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/security", label: "Security" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, signOut, loading: authLoading } = useAuth();

  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const channelRef = useRef<any>(null);

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
  }, [user, router]);

  // Auto-close the mobile menu on navigation
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
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

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const linkClass = (active: boolean) =>
    `relative h-14 inline-flex items-center whitespace-nowrap text-sm font-medium tracking-wide transition-colors ${
      active ? "text-primary-400" : "text-dark-300 hover:text-dark-100"
    }`;

  return (
    <AdminPinGate>
      <div className="min-h-screen peja-hud">
        <NotificationPopupListener
          table="admin_notifications"
          userColumn="recipient_id"
          onNotification={fetchUnreadCount}
        />

        {/* ── Top nav ─────────────────────────────────────────── */}
        <header className="fixed top-0 left-0 right-0 z-50 glass-header border-b border-white/10">
          <div className="mx-auto flex h-14 items-center gap-6 px-4 lg:px-8">
            <Link href="/admin" className="text-lg font-bold text-primary-400 shrink-0">
              Peja Admin
            </Link>

            {/* Desktop: inline nav */}
            <nav className="hidden lg:flex items-center gap-6 flex-1 min-w-0 overflow-x-auto">
              {navItems.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} className={linkClass(active)}>
                    <span className="inline-flex items-center gap-2">
                      {item.label}
                      {item.badge && unreadCount > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </span>
                    {active && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary-400 rounded-full" />
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="hidden lg:flex items-center gap-3 ml-auto shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary-600/20 flex items-center justify-center">
                  <span className="text-primary-400 text-sm font-semibold">
                    {user.full_name?.charAt(0) || "A"}
                  </span>
                </div>
                <span className="text-sm text-dark-200 max-w-[140px] truncate">{user.full_name}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>
            </div>

            {/* Mobile: burger toggle (2-line ↔ X) */}
            <button
              type="button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="lg:hidden ml-auto relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors"
            >
              <span
                className={`absolute block h-[2px] w-6 bg-white rounded-full transition-all duration-300 ease-out ${
                  menuOpen ? "rotate-45 translate-y-0" : "-translate-y-[5px]"
                }`}
              />
              <span
                className={`absolute block h-[2px] w-6 bg-white rounded-full transition-all duration-300 ease-out ${
                  menuOpen ? "-rotate-45 translate-y-0" : "translate-y-[5px]"
                }`}
              />
            </button>
          </div>

          {/* Mobile drawer (slides down from under the header) */}
          <div
            className={`lg:hidden overflow-hidden border-t border-white/10 transition-[max-height,opacity] duration-300 ease-out ${
              menuOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
            }`}
          >
            <nav className="px-4 py-3 space-y-1 bg-dark-950/90 backdrop-blur-md">
              {navItems.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active ? "text-primary-400 bg-primary-600/10" : "text-dark-200 hover:bg-white/5"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.badge && unreadCount > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </Link>
                );
              })}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 mt-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>
            </nav>
          </div>
        </header>

        {/* Backdrop to dim content while drawer is open */}
        {menuOpen && (
          <div
            className="lg:hidden fixed inset-0 top-14 z-40 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
        )}

        <main className="pt-14 min-h-screen">{children}</main>
      </div>
    </AdminPinGate>
  );
}
