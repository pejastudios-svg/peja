"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {  Bell } from "lucide-react";
import GuardianInAppToasts from "@/components/notifications/GuardianInAppToasts";
import {
  LayoutDashboard,
  Flag,
  CheckCircle,
  BookOpen,
  BarChart3,
  LogOut,
  Menu,
  X,
  Loader2,
  ArrowLeft,
} from "lucide-react";

const navItems = [
  { href: "/guardian", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/guardian/notifications", icon: Bell, label: "Notifications" },
  { href: "/guardian/queue", icon: Flag, label: "Review Queue" },
  { href: "/guardian/actions", icon: CheckCircle, label: "My Actions" },
  { href: "/guardian/guidelines", icon: BookOpen, label: "Guidelines" },
  { href: "/guardian/stats", icon: BarChart3, label: "My Stats" },
];

export default function GuardianLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, signOut, loading: authLoading } = useAuth();
  const [isGuardian, setIsGuardian] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [guardianUnread, setGuardianUnread] = useState(0);

const fetchGuardianUnread = async () => {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;

  const { count } = await supabase
    .from("guardian_notifications")
    .select("*", { count: "exact", head: true })
    .eq("recipient_id", uid)
    .neq("is_read", true); // ✅ counts false + null

  setGuardianUnread(count || 0);
};

useEffect(() => {
  let ch: any;

  (async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;

    await fetchGuardianUnread();

    ch = supabase
      .channel("guardian-unread-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guardian_notifications", filter: `recipient_id=eq.${uid}` },
        () => fetchGuardianUnread()
      )
      .subscribe();
  })();

  return () => {
    if (ch) supabase.removeChannel(ch);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  useEffect(() => {
    checkGuardianStatus();
  }, [user]);

  const checkGuardianStatus = async () => {
    if (!user) {
      setChecking(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("users")
        .select("is_guardian, is_admin")
        .eq("id", user.id)
        .single();

      if (error || (!data?.is_guardian && !data?.is_admin)) {
        router.push("/");
        return;
      }

      setIsGuardian(true);
    } catch (error) {
      console.error("Guardian check error:", error);
      router.push("/");
    } finally {
      setChecking(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  if (!user || !isGuardian) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-dark-100 mb-2">Access Denied</h1>
          <p className="text-dark-400 mb-4">You need to be a Guardian to access this area.</p>
          <Link href="/" className="text-primary-400 hover:underline">
            Go back home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950">
      <GuardianInAppToasts />
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 glass-header h-14 flex items-center justify-between px-4">
        <button onClick={() => setSidebarOpen(true)} className="p-2">
          <Menu className="w-5 h-5 text-dark-200" />
        </button>
        <span className="text-lg font-bold text-primary-400">Guardian Hub</span>
        <Link href="/" className="p-2">
          <ArrowLeft className="w-5 h-5 text-dark-200" />
        </Link>
      </header>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-dark-900 border-r border-white/10">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <span className="text-lg font-bold text-primary-400">Guardian Hub</span>
              <button onClick={() => setSidebarOpen(false)} className="p-1">
                <X className="w-5 h-5 text-dark-400" />
              </button>
            </div>
            <nav className="p-4 space-y-1">
              {navItems.map((item) => {
  const Icon = item.icon;
  const isActive = pathname === item.href;

  return (
    <Link
      key={item.href}
      href={item.href}
      onClick={() => setSidebarOpen(false)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
        isActive ? "bg-primary-600/20 text-primary-400" : "text-dark-300 hover:bg-white/5"
      }`}
    >
      <Icon className="w-5 h-5" />
      <span>{item.label}</span>

      {item.href === "/guardian/notifications" && guardianUnread > 0 && (
        <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center shadow-[0_0_14px_rgba(139,92,246,0.85)] ring-1 ring-primary-300/40">
          {guardianUnread > 99 ? "99+" : guardianUnread}
        </span>
      )}
    </Link>
  );
})}
              <hr className="border-white/10 my-4" />
              <Link
                href="/"
                onClick={() => setSidebarOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-dark-300 hover:bg-white/5"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Back to App</span>
              </Link>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-400 hover:bg-red-500/10"
              >
                <LogOut className="w-5 h-5" />
                <span>Log Out</span>
              </button>
            </nav>
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-64 bg-dark-900 border-r border-white/10">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-xl font-bold text-primary-400">Guardian Hub</h1>
          <p className="text-sm text-dark-500 mt-1">Content Moderation</p>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
  const Icon = item.icon;
  const isActive = pathname === item.href;

  return (
    <Link
      key={item.href}
      href={item.href}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
        isActive ? "bg-primary-600/20 text-primary-400" : "text-dark-300 hover:bg-white/5"
      }`}
    >
      <Icon className="w-5 h-5" />
      <span>{item.label}</span>

      {item.href === "/guardian/notifications" && guardianUnread > 0 && (
        <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center shadow-[0_0_14px_rgba(139,92,246,0.85)] ring-1 ring-primary-300/40">
          {guardianUnread > 99 ? "99+" : guardianUnread}
        </span>
      )}
    </Link>
  );
})}
          <hr className="border-white/10 my-4" />
          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-dark-300 hover:bg-white/5"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to App</span>
          </Link>
        </nav>
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center">
              <span className="text-primary-400 font-semibold">
                {user.full_name?.charAt(0) || "G"}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-dark-100 truncate">{user.full_name}</p>
              <p className="text-xs text-primary-400">Guardian</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Log Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen">
        {children}
      </main>
    </div>
  );
}