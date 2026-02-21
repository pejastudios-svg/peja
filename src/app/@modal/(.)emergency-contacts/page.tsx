"use client";

import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import EmergencyContactsPage from "@/app/emergency-contacts/page";

export default function EmergencyContactsModal() {
  return (
    <FullScreenModalShell emitOverlayEvents={false} emitModalEvents={true}>
      <EmergencyContactsPage />
    </FullScreenModalShell>
  );
}