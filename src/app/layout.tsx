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

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "Peja - Community Safety Alerts",
  description: "Real-time incident alerts for your community",
};

export default function RootLayout({
  children,
  modal,
  overlay,
  watch,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  overlay: React.ReactNode;
  watch: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Leaflet CSS */}
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
        <Suspense fallback={null}>
        <HistorySyncGuard />
        </Suspense>
        <UserGestureAudioUnlocker />
        <InAppNotificationToasts />
        <AccountStatusBanner />
        {children}
        {overlay}
        {watch}
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