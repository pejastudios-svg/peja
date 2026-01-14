"use client";

import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import HelpPage from "@/app/help/page";

export default function HelpModal() {
  return (
    <FullScreenModalShell emitOverlayEvents={false} emitModalEvents={true}>
      <HelpPage />
    </FullScreenModalShell>
  );
}