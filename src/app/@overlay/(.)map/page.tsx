"use client";

import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import MapPage from "@/app/map/page";

export default function MapOverlay() {
  return (
    <FullScreenModalShell>
      <MapPage />
    </FullScreenModalShell>
  );
}