"use client";
import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import EditProfilePage from "@/app/profile/edit/page";
export default function EditProfileOverlay() {
  return <FullScreenModalShell><EditProfilePage /></FullScreenModalShell>;
}