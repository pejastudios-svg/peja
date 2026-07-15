"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { WelcomeSequence } from "@/components/community/WelcomeSequence";

// Map-first home (PEJA_MAP_HOME_DESIGN.md). MapLibre can't SSR.
const MapHome = dynamic(() => import("@/components/home/MapHome"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-dark-950 flex items-center justify-center">
      <PejaSpinner />
    </div>
  ),
});

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // Logged-out visitors get the onboarding pitch; the whole app shell is
  // account-only now (shared /post links stay public for virality).
  useEffect(() => {
    if (!loading && !user) router.replace("/welcome");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="fixed inset-0 bg-dark-950 flex items-center justify-center">
        <PejaSpinner />
      </div>
    );
  }

  // BottomNav is global (mounted in layout) and shows itself on "/".
  return (
    <>
      <MapHome />
      <WelcomeSequence />
    </>
  );
}
