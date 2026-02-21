"use client";

import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import TermsPage from "@/app/terms/page";

export default function TermsModal() {
  return (
    <FullScreenModalShell emitOverlayEvents={false} emitModalEvents={true}>
      <TermsPage />
    </FullScreenModalShell>
  );
}