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
import { MessageCacheProvider } from "@/context/MessageCacheContext";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
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
  viewportFit: "cover",
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
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body className={`${poppins.variable} font-sans antialiased`}>
          <ToastProvider>
          <AuthProvider>
  <ConfirmProvider>
    <AudioProvider>
      <VideoHandoffProvider>
        <PageCacheProvider>
          <FeedProvider>
            <MessageCacheProvider>
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
                  <CapacitorPushNotifications />
                  <ScrollRestorer />
                  <CapacitorKeyboardHandler />
                  {children}
                  {overlay}
                  {modal}
                </MessageCacheProvider>
              </FeedProvider>
            </PageCacheProvider>
          </VideoHandoffProvider>
        </AudioProvider>
      </ConfirmProvider>
    </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}