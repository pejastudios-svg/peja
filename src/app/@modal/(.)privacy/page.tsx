"use client";

import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import PrivacyPage from "@/app/privacy/page";

export default function PrivacyModal() {
  return (
    <FullScreenModalShell emitOverlayEvents={false} emitModalEvents={true}>
      <PrivacyPage />
    </FullScreenModalShell>
  );
}