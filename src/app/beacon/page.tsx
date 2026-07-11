"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Header } from "@/components/layout/Header";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { PairBeaconFlow } from "@/components/beacon/PairBeaconFlow";
import { BeaconDashboard } from "@/components/beacon/BeaconDashboard";
import { canUseBeacon, type BeaconDevice } from "@/lib/beacon";

export default function BeaconPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [device, setDevice] = useState<BeaconDevice | null>(null);
  const [loading, setLoading] = useState(true);

  // Closed pilot: anyone else who lands here goes home.
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    if (!canUseBeacon(user.email)) router.replace("/");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || !canUseBeacon(user.email)) return;
    (async () => {
      const { data } = await supabase
        .from("devices")
        .select("*")
        .eq("user_id", user.id)
        .neq("status", "unpaired")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setDevice((data as BeaconDevice) || null);
      setLoading(false);
    })();
  }, [user]);

  if (authLoading || !user || !canUseBeacon(user.email)) return null;

  return (
    <div className="min-h-screen bg-dark-950">
      <Header variant="back" title="Beacon" onBack={() => router.back()} />
      <main className="pt-app-header-pill">
        {loading ? (
          <div className="flex justify-center pt-24">
            <PejaSpinner />
          </div>
        ) : device ? (
          <BeaconDashboard device={device} onUnpaired={() => setDevice(null)} />
        ) : (
          <PairBeaconFlow onPaired={(d) => setDevice(d)} />
        )}
      </main>
    </div>
  );
}
