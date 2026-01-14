"use client";

import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import ProfilePage from "@/app/profile/page";

export default function ProfileOverlay() {
  return (
    <FullScreenModalShell>
      <ProfilePage />
    </FullScreenModalShell>
  );
}