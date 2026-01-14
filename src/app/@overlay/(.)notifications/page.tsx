"use client";

import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import NotificationsPage from "@/app/notifications/page";

export default function NotificationsOverlay() {
  return (
    <FullScreenModalShell>
      <NotificationsPage />
    </FullScreenModalShell>
  );
}