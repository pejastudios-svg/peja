import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Poppins } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { FeedProvider } from "@/context/FeedContext";
import AnalyticsTracker from "@/components/analytics/AnalyticsTracker";
import { ConfirmProvider } from "@/context/ConfirmContext";
import { AudioProvider } from "@/context/AudioContext";
import { VideoHandoffProvider } from "@/context/VideoHandoffContext";
import { PageCacheProvider } from "@/context/PageCacheContext";
import RoutePrefetcher from "@/components/navigation/RoutePrefetcher";
import HistorySyncGuard from "@/components/navigation/HistorySyncGuard";
import { IOSSwipeBack } from "@/components/navigation/IOSSwipeBack";
import InAppNotificationToasts from "@/components/notifications/InAppNotificationToasts";
import UserGestureAudioUnlocker from "@/components/notifications/UserGestureAudioUnlocker";
import AccountStatusBanner from "@/components/system/AccountStatusBanner";
import { ToastProvider } from "@/context/ToastContext";
import GlobalScrollManager from "@/components/navigation/GlobalScrollManager";
import { CapacitorInit } from "@/components/navigation/CapacitorInit";
import { CapacitorBackButton } from "@/components/navigation/CapacitorBackButton";
import { CapacitorPushNotifications } from "@/components/notifications/CapacitorPushNotifications";
import { ScrollRestorer } from "@/components/navigation/ScrollRestorer";
import { CapacitorKeyboardHandler } from "@/components/navigation/CapacitorKeyboardHandler";
import { ChatBootstrap } from "@/components/chat/ChatBootstrap";
import { ServiceWorkerRegistrar } from "@/components/navigation/ServiceWorkerRegistrar";
import { TutorialProvider } from "@/components/tutorial/TutorialOverlay";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { CheckInMonitor } from "@/components/safety/CheckInMonitor";
import { LoginPrompt } from "@/components/auth/LoginPrompt";
import { PostAuthRedirect } from "@/components/auth/PostAuthRedirect";
import { SlowConnectionBanner } from "@/components/system/SlowConnectionBanner";
import { BackgroundPrefetcher } from "@/components/navigation/BackgroundPrefetcher";
import { Analytics } from "@vercel/analytics/next"
import { OfflineBanner } from "@/components/system/OfflineBanner";
import { ThemeProvider } from "@/context/ThemeContext";
import { BottomNav } from "@/components/layout/BottomNav";
import { OutboxBootstrap } from "@/components/system/OutboxBootstrap";
import { EmergencyContactsBootstrap } from "@/components/system/EmergencyContactsBootstrap";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Peja - Your Brother's Keeper",
  description: "Real-time incident alerts for your community",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Intentionally NOT "cover". On Android Chrome some OEM/Chromium variants
  // let the page draw under the status bar with viewport-fit=cover but never
  // expose a non-zero env(safe-area-inset-top), so headers slid under the
  // time/battery. Without "cover", the browser reserves the status-bar area
  // itself — no CSS padding needed, no overlap. Capacitor-native still
  // handles its own insets via --cap-status-bar-height.
};

export default function RootLayout({
  children,
  modal,
  overlay,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  overlay: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* No-flicker theme bootstrap — runs before paint to set data-theme
            from localStorage. Adds .theme-preload so the global bg/color
            transition rule is suppressed for first paint (otherwise the
            transition smoothly fades from the default dark bg to the saved
            light bg over 300ms = the visible flash users were reporting).
            Class is removed on the next animation frame so subsequent
            theme toggles still animate smoothly. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("peja-theme");var v=(t==="light"||t==="dark")?t:"dark";var d=document.documentElement;d.setAttribute("data-theme",v);d.classList.add("theme-preload");requestAnimationFrame(function(){requestAnimationFrame(function(){d.classList.remove("theme-preload");});});}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`,
          }}
        />
        {/* Status-bar height fallback for PWAs / mobile browsers where
            env(safe-area-inset-top) reports 0 despite the WebView extending
            under the system status bar. CapacitorInit handles native; this
            covers regular Android Chrome / installed PWAs. Sets
            --cap-status-bar-height which --app-top-inset already reads. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              if (typeof window === "undefined") return;
              var compute = function(){
                var root = document.documentElement;
                // If Capacitor already set this, don't override.
                if (root.classList.contains("capacitor-native")) return;
                // Trust env() when it reports a real value.
                var probe = document.createElement("div");
                probe.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top,0px);width:0;visibility:hidden;";
                document.body.appendChild(probe);
                var envInset = probe.getBoundingClientRect().height;
                document.body.removeChild(probe);
                if (envInset > 0) return; // env works, nothing to do.
                // Heuristic for PWAs / Android Chrome that don't expose the inset.
                // standalone display mode (PWA) is the only case where the WebView
                // typically extends under the status bar without env() reporting it.
                var isStandalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
                if (!isStandalone) return;
                var screenH = window.screen && window.screen.height;
                var innerH = window.innerHeight;
                if (!screenH || !innerH || screenH <= innerH) return;
                // Estimate: difference, capped 24–48dp. iOS PWAs are usually
                // handled by env(); this is mostly for Android PWAs.
                var diff = screenH - innerH;
                var estimated = Math.max(24, Math.min(48, diff));
                root.style.setProperty("--cap-status-bar-height", estimated + "px");
              };
              if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", compute);
              } else {
                compute();
              }
            }catch(e){}})();`,
          }}
        />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

        <link rel="preconnect" href="https://ojtuqatuohxyxdxiqmsn.supabase.co" />
        <link rel="preconnect" href="https://res.cloudinary.com" />
        <link rel="dns-prefetch" href="https://ojtuqatuohxyxdxiqmsn.supabase.co" />
        <link rel="dns-prefetch" href="https://res.cloudinary.com" />
        <link rel="dns-prefetch" href="https://unpkg.com" />

        {/* Leaflet CSS is intentionally NOT loaded here. It's a render-blocking
            external stylesheet from unpkg.com that only the /map route needs.
            Loading it in the root meant every page's first paint was gated on
            unpkg reachability — when users opened the app on bad/no data the
            HTML rendered unstyled while waiting. IncidentMapInner injects it
            on mount instead. */}
       <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            if (window.location.hash) return;
            if (window.location.hostname === "localhost") return;
            var APP_VERSION = "${process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev"}";
            if (APP_VERSION === "dev") return;
            var stored = localStorage.getItem("peja-app-version");
            // If offline, do NOT nuke caches + reload — the reload would
            // fetch nothing and leave the user staring at an unstyled
            // page. Stamp the version as "pending" so we run the upgrade
            // the next time the device comes back online.
            function runUpgrade() {
              localStorage.setItem("peja-app-version", APP_VERSION);
              if ("caches" in window) {
                caches.keys().then(function(names) {
                  return Promise.all(names.map(function(name) { return caches.delete(name); }));
                }).then(function() {
                  window.location.reload();
                });
              } else {
                window.location.reload();
              }
            }
            if (stored && stored !== APP_VERSION) {
              var online = (typeof navigator !== "undefined" && "onLine" in navigator) ? navigator.onLine : true;
              if (online) {
                runUpgrade();
              } else {
                // Defer until the device reconnects. One-shot.
                var onOnline = function() {
                  window.removeEventListener("online", onOnline);
                  runUpgrade();
                };
                window.addEventListener("online", onOnline);
              }
            } else if (!stored) {
              localStorage.setItem("peja-app-version", APP_VERSION);
            }
          })();
        `}} />
      </head>
      <body className={`${poppins.variable} font-sans antialiased`}>
        <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <ConfirmProvider>
              <AudioProvider>
                <VideoHandoffProvider>
                  <PageCacheProvider>
                    <FeedProvider>
                        <ChatBootstrap />
                        <OutboxBootstrap />
                        <EmergencyContactsBootstrap />
                        <AnalyticsTracker />
                        <RoutePrefetcher />
                        <GlobalScrollManager />
                        <Suspense fallback={null}>
                          <HistorySyncGuard />
                        </Suspense>
                        <UserGestureAudioUnlocker />
                        <InAppNotificationToasts />
                        <AccountStatusBanner />
                        <CapacitorInit />
                        <CapacitorBackButton />
                        <IOSSwipeBack />
                        <CapacitorPushNotifications />
                        <ScrollRestorer />
                        <CapacitorKeyboardHandler />
                        <ServiceWorkerRegistrar />
                        <CheckInMonitor />
                        <SlowConnectionBanner />
                        <OfflineBanner />
                        <LoginPrompt />
                        <PostAuthRedirect />
                        <BackgroundPrefetcher />
                        <ServiceWorkerRegistration />
                        <Analytics/>
                        <TutorialProvider>
                        {children}
                        {overlay}
                        {modal}
                        {/* BottomNav is global so the sliding active-tab
                            pill survives navigation. The component itself
                            decides when to hide via its isHidden check
                            (post / chat detail routes). */}
                        <BottomNav />
                        </TutorialProvider>
                    </FeedProvider>
                  </PageCacheProvider>
                </VideoHandoffProvider>
              </AudioProvider>
            </ConfirmProvider>
          </AuthProvider>
        </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}