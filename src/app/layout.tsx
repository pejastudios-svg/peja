import type { Metadata } from "next";
import { Suspense } from "react";
import { Poppins } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { FeedProvider } from "@/context/FeedContext";
import AnalyticsTracker from "@/components/analytics/AnalyticsTracker";
import { ConfirmProvider } from "@/context/ConfirmContext";
import { AudioProvider } from "@/context/AudioContext";
import RoutePrefetcher from "@/components/navigation/RoutePrefetcher";
import HistorySyncGuard from "@/components/navigation/HistorySyncGuard";
import InAppNotificationToasts from "@/components/notifications/InAppNotificationToasts";
import UserGestureAudioUnlocker from "@/components/notifications/UserGestureAudioUnlocker";
import AccountStatusBanner from "@/components/system/AccountStatusBanner";
import { ToastProvider } from "@/context/ToastContext";
import GlobalScrollManager from "@/components/navigation/GlobalScrollManager";
import { CapacitorInit } from "@/components/navigation/CapacitorInit";
import { CapacitorBackButton } from "@/components/navigation/CapacitorBackButton";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "Peja - Your Brother's Keeper",
  description: "Real-time incident alerts for your community",
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
                <FeedProvider>
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
                  {children}
                  {overlay}
                  {modal}
                </FeedProvider>
              </AudioProvider>
            </ConfirmProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}