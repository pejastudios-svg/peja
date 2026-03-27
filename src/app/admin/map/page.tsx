"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronUp, ChevronDown, MapPin, Navigation } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { SOS_TAGS } from "@/lib/types";
import type { MapHelper } from "@/components/admin/AdminLiveMap";
import { formatDistanceToNow } from "date-fns";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";

const AdminLiveMap = dynamic(() => import("@/components/admin/AdminLiveMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-dark-950">
      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

type SOSDispatch = {
  id: string;
  userName: string;
  userAvatar: string | null;
  address: string;
  tag: string | null;
  created_at: string;
  helpers: {
    id: string;
    name: string;
    avatar_url: string | null;
    eta: number;
    milestone: string | null;
  }[];
};

export default function AdminMapFullscreenPage() {
  const router = useRouter();
  const [mapHelpers, setMapHelpers] = useState<MapHelper[]>([]);
  const [dispatches, setDispatches] = useState<SOSDispatch[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHelpers = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch("/api/sos-helpers", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;

      const json = await res.json();
      const helpers: MapHelper[] = (json.helpers || []).map((h: any) => ({
        id: h.id,
        name: h.name,
        avatar_url: h.avatar_url,
        lat: h.lat,
        lng: h.lng,
        eta: h.eta,
        sosId: h.sosId,
        milestone: h.milestone,
      }));
      setMapHelpers(helpers);

      const sosAlerts: any[] = json.sosAlerts || [];
      const dispatchList: SOSDispatch[] = sosAlerts.map((s: any) => {
        const sosHelpers = (json.helpers || [])
          .filter((h: any) => h.sosId === s.id)
          .map((h: any) => ({
            id: h.id,
            name: h.name,
            avatar_url: h.avatar_url,
            eta: h.eta,
            milestone: h.milestone,
          }));
        return {
          id: s.id,
          userName: s.userName,
          userAvatar: s.userAvatar,
          address: s.address || "Unknown",
          tag: s.tag,
          created_at: s.created_at,
          helpers: sosHelpers,
        };
      });
      setDispatches(dispatchList);
    } catch {}
  }, []);

  useEffect(() => {
    fetchHelpers();
    pollRef.current = setInterval(fetchHelpers, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchHelpers]);

  const totalHelpers = dispatches.reduce((sum, d) => sum + d.helpers.length, 0);

  return (
    <div className="fixed inset-0 z-[9999] bg-dark-950 flex flex-col">
      <header className="shrink-0 flex items-center justify-between px-4 h-12 bg-dark-950/90 backdrop-blur-sm border-b border-white/5 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-sm font-semibold text-dark-100">Live Map</h1>
        </div>
        {dispatches.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-red-400 font-bold">{dispatches.length} SOS</span>
            <span className="text-dark-500">|</span>
            <span className="text-green-400 font-bold">{totalHelpers} Helper{totalHelpers !== 1 ? "s" : ""}</span>
          </div>
        )}
      </header>

      <div className="flex-1 relative">
        <AdminLiveMap helpers={mapHelpers} />

        {/* Floating dispatch panel */}
        {dispatches.length > 0 && (
          <div
            className="absolute bottom-3 left-3 right-3 z-20 rounded-2xl overflow-hidden"
            style={{
              background: "rgba(12, 8, 24, 0.92)",
              border: "1px solid rgba(255,255,255,0.1)",
              backdropFilter: "blur(16px)",
              boxShadow: "0 -4px 30px rgba(0,0,0,0.5)",
              maxHeight: panelOpen ? "280px" : "44px",
              transition: "max-height 300ms ease",
            }}
          >
            {/* Toggle bar */}
            <button
              onClick={() => setPanelOpen(!panelOpen)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Navigation className="w-3.5 h-3.5 text-green-400" />
                <span className="text-xs font-bold text-dark-200">
                  Dispatch ({dispatches.length} SOS, {totalHelpers} helpers)
                </span>
              </div>
              {panelOpen ? (
                <ChevronDown className="w-4 h-4 text-dark-400" />
              ) : (
                <ChevronUp className="w-4 h-4 text-dark-400" />
              )}
            </button>

            {/* Dispatch list */}
            {panelOpen && (
              <div className="px-3 pb-3 max-h-[220px] overflow-y-auto space-y-2 scrollbar-hide">
                {dispatches.map((d) => {
                  const tagInfo = d.tag ? SOS_TAGS.find((t) => t.id === d.tag) : null;
                  return (
                    <div key={d.id} className="p-3 rounded-xl bg-red-500/5 border border-red-500/15">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-full overflow-hidden border border-red-500/40 shrink-0">
                          <img
                            src={d.userAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(d.userName)}&background=dc2626&color=fff`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white truncate">{d.userName}</p>
                          <p className="text-[10px] text-dark-500 truncate flex items-center gap-1">
                            <MapPin className="w-2.5 h-2.5 shrink-0" />{d.address}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {tagInfo && (
                            <span className="text-[10px] text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded">{tagInfo.icon}</span>
                          )}
                          <p className="text-[9px] text-dark-600">{formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}</p>
                        </div>
                      </div>

                      {d.helpers.length > 0 ? (
                        <div className="space-y-1">
                          {d.helpers.map((h) => (
                            <div key={h.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-green-500/5 border border-green-500/10">
                              <div className="w-5 h-5 rounded-full overflow-hidden border border-green-500/30 shrink-0">
                                <img
                                  src={h.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(h.name.charAt(0))}&background=22c55e&color=fff`}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <span className="text-[11px] text-white font-medium flex-1 truncate">{h.name}</span>
                              <span className={`text-[11px] font-bold ${h.milestone === "arrived" ? "text-green-400" : "text-green-300"}`}>
                                {h.milestone === "arrived" ? "Arrived" : `${h.eta} min`}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-dark-600 text-center py-1">No helpers yet</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}