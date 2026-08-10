"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Header } from "@/components/layout/Header";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { PairBeaconFlow } from "@/components/beacon/PairBeaconFlow";
import { BeaconDashboard } from "@/components/beacon/BeaconDashboard";
import { BeaconFirstRunManual } from "@/components/beacon/BeaconFirstRunManual";
import { BeaconFleet } from "@/components/beacon/BeaconFleet";
import { canUseBeacon, type BeaconDevice } from "@/lib/beacon";

// The first visit to the Beacon area shows the manual full screen, and the
// reader has to reach the end before Continue unlocks. Keyed per user so a
// second account on the same phone still gets it. v1 in the key so a
// future rewrite of the manual can re-show it to everyone by bumping it.
const manualKey = (userId: string) => `peja-beacon-manual-v1:${userId}`;

// Beacon Circle: one account hosts any number of Beacons. Zero devices
// goes straight to pairing; exactly one keeps today's straight-to-dashboard
// behaviour; more than one lands on the fleet list, and each card opens
// that wearer's dashboard.

type View = "auto" | "list" | "pair";

export default function BeaconPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [devices, setDevices] = useState<BeaconDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("auto");
  const [loading, setLoading] = useState(true);
  // null = not decided yet, keeps the flow from flashing before we know.
  const [manualDone, setManualDone] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    try {
      setManualDone(!!localStorage.getItem(manualKey(user.id)));
    } catch {
      // Storage unavailable (private mode): read-only visit, do not gate.
      setManualDone(true);
    }
  }, [user]);

  // Closed pilot: anyone else who lands here goes home.
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    if (!canUseBeacon(user.email)) router.replace("/");
  }, [user, authLoading, router]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("devices")
      .select("*")
      .eq("user_id", user.id)
      .neq("status", "unpaired")
      .order("created_at", { ascending: true });
    setDevices((data as BeaconDevice[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!user || !canUseBeacon(user.email)) return;
    refresh();
  }, [user, refresh]);

  if (authLoading || !user || !canUseBeacon(user.email)) return null;

  // Manual first. Everything else waits until it has been read once.
  if (manualDone === null) return null;
  if (!manualDone) {
    return (
      <BeaconFirstRunManual
        onDone={() => {
          try {
            localStorage.setItem(manualKey(user.id), "1");
          } catch {}
          setManualDone(true);
        }}
        onExit={() => router.back()}
      />
    );
  }

  const selected = devices.find((d) => d.id === selectedId) || null;
  const showPair = view === "pair" || (!loading && devices.length === 0);
  const showDashboard =
    !showPair && (selected || (view === "auto" && devices.length === 1));
  const dashboardDevice = selected || devices[0] || null;

  return (
    <div className="min-h-screen bg-dark-950">
      <Header
        variant="back"
        title="Beacon"
        onBack={() => {
          // Inner navigation first: pairing or a selected wearer falls back
          // to the list when there is a list to fall back to.
          if (view === "pair" && devices.length > 0) {
            setView(devices.length > 1 ? "list" : "auto");
            return;
          }
          if (selectedId && devices.length > 1) {
            setSelectedId(null);
            setView("list");
            return;
          }
          router.back();
        }}
      />
      <main className="pt-app-header-pill">
        {loading ? (
          <div className="flex justify-center pt-24">
            <PejaSpinner />
          </div>
        ) : showPair ? (
          <PairBeaconFlow
            onPaired={(d) => {
              setDevices((prev) => {
                const i = prev.findIndex((x) => x.id === d.id);
                if (i === -1) return [...prev, d];
                const next = [...prev];
                next[i] = d;
                return next;
              });
              setSelectedId(d.id);
              setView("auto");
            }}
          />
        ) : showDashboard && dashboardDevice ? (
          <>
            <BeaconDashboard
              device={dashboardDevice}
              onUnpaired={() => {
                setDevices((prev) => prev.filter((d) => d.id !== dashboardDevice.id));
                setSelectedId(null);
                setView("auto");
              }}
            />
            {devices.length === 1 && (
              <div className="px-4 pb-24 max-w-md mx-auto">
                <button
                  onClick={() => setView("pair")}
                  className="w-full py-3.5 rounded-2xl border border-dashed border-dark-600 text-sm font-medium text-primary-400 active:scale-[0.97] transition-transform"
                >
                  Pair another Beacon
                </button>
              </div>
            )}
          </>
        ) : (
          <BeaconFleet
            devices={devices}
            onSelect={(d) => setSelectedId(d.id)}
            onPairAnother={() => setView("pair")}
            onRefresh={refresh}
          />
        )}
      </main>
    </div>
  );
}
