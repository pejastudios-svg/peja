"use client";
import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import BecomeGuardianPage from "@/app/become-guardian/page";
export default function BecomeGuardianOverlay() {
  return <FullScreenModalShell><BecomeGuardianPage /></FullScreenModalShell>;
}