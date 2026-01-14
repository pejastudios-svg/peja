"use client";

import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import CreatePage from "@/app/create/page";

export default function CreateOverlay() {
  return (
    <FullScreenModalShell>
      <CreatePage />
    </FullScreenModalShell>
  );
}