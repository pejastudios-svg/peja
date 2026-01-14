"use client";
import FullScreenModalShell from "@/components/navigation/FullScreenModalShell";
import SearchPage from "@/app/search/page";
export default function SearchOverlay() {
  return <FullScreenModalShell><SearchPage /></FullScreenModalShell>;
}