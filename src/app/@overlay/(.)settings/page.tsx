"use client";
import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import SettingsPage from "@/app/settings/page";
export default function SettingsOverlay() {
  return <FullScreenModalShell><SettingsPage /></FullScreenModalShell>;
}