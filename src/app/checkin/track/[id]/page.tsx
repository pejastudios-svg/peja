"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { apiUrl } from "@/lib/api";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Clock,
  MapPin,
  Phone,
  User,
  Radio,
  CheckCircle,
  Shield,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

const TrackingMap = dynamic(() => import("@/components/safety/TrackingMap"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-dark-800">
      <PejaSpinner className="w-8 h-8" />
    </div>
  ),
});

interface CheckInData {
  id: string;
  status: "active" | "missed";
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  location_updated_at: string | null;
  next_check_in_at: string;
  last_confirmed_at: string;
  missed_count: number;
  check_in_interval_minutes: number;
  created_at: string;
}

interface OwnerData {
  id: string;
  full_name: string;
  avatar_url?: string;
}

export default function CheckInTrackPage() {
  const params = useParams();
  const router = useRouter();
  const { session, user } = useAuth();
  const checkinId = params.id as string;

  const [checkin, setCheckin] = useState<CheckInData | null>(null);
  const [owner, setOwner] = useState<OwnerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState("");
  const [isOverdue, setIsOverdue] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const headers = useCallback(() => ({
    Authorization: `Bearer ${session?.access_token || ""}`,
  }), [session?.access_token]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/checkin/view/?id=${checkinId}`), {
        headers: headers(),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Could not load check-in");
        setLoading(false);
        return;
      }

      setCheckin(data.checkin);
      setOwner(data.owner);
      setError(null);
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  }, [checkinId, headers]);

useEffect(() => {
    if (!session?.access_token) return;
    fetchData();

    // Realtime subscription for instant updates
    const channel = supabase
      .channel(`checkin-status-${checkinId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "safety_checkins", filter: `id=eq.${checkinId}` },
        (payload) => {
          const updated = payload.new as any;
          
          if (updated.status === "cancelled" || updated.status === "confirmed") {
            setError("Check-in not found or ended");
            setCheckin(null);
            return;
          }

          setCheckin(prev => prev ? {
            ...prev,
            status: updated.status,
            latitude: updated.latitude ?? prev.latitude,
            longitude: updated.longitude ?? prev.longitude,
            address: updated.address ?? prev.address,
            location_updated_at: updated.location_updated_at ?? prev.location_updated_at,
            next_check_in_at: updated.next_check_in_at ?? prev.next_check_in_at,
            last_confirmed_at: updated.last_confirmed_at ?? prev.last_confirmed_at,
            missed_count: updated.missed_count ?? prev.missed_count,
          } : null);
        }
      )
      .subscribe();

    // Keep a slower poll as fallback (every 60 seconds)
    pollingRef.current = setInterval(fetchData, 15000);

    return () => {
      supabase.removeChannel(channel);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchData, session?.access_token, checkinId]);

  // Countdown
  useEffect(() => {
    if (!checkin) return;

    const update = () => {
      const now = Date.now();
      const target = new Date(checkin.next_check_in_at).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft("Overdue");
        setIsOverdue(true);
        return;
      }

      setIsOverdue(false);
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);

      if (hours > 0) setTimeLeft(`${hours}h ${mins}m`);
      else if (mins > 0) setTimeLeft(`${mins}m ${secs}s`);
      else setTimeLeft(`${secs}s`);
    };

    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [checkin]);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-dark-950">
        <div className="text-center">
          <PejaSpinner className="w-10 h-10 mx-auto mb-3" />
          <p className="text-dark-400 text-sm">Loading location...</p>
        </div>
      </div>
    );
  }

  if (error || !checkin) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-dark-950 p-6">
        <AlertTriangle className="w-14 h-14 text-red-400 mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">
          {error === "Check-in not found or ended" ? "Check-In Ended" : "Cannot View Location"}
        </h1>
        <p className="text-dark-400 text-center mb-6">
          {error === "Check-in not found or ended"
            ? "This person is no longer sharing their location."
            : error || "Something went wrong."}
        </p>
        <button
          onClick={() => router.back()}
          className="px-6 py-3 bg-primary-600 text-white rounded-xl font-medium"
        >
          Go Back
        </button>
      </div>
    );
  }

  const hasLocation = checkin.latitude && checkin.longitude;

  return (
    <div className="fixed inset-0 flex flex-col bg-dark-950">
      {/* Header */}
      <header className="relative z-20 glass-header">
        <div className="flex items-center justify-between px-4 h-14">
          <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/10 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <div className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${isOverdue ? "text-red-400" : "text-green-400"} animate-pulse`} />
            <span className="text-sm font-medium text-dark-100">Live Location</span>
          </div>
          <div className="w-9" />
        </div>
      </header>

      {/* Map */}
      <div className="flex-1 relative">
        {hasLocation ? (
            <TrackingMap
            latitude={checkin.latitude!}
            longitude={checkin.longitude!}
            checkinId={checkin.id}
            ownerName={owner?.full_name || "User"}
            ownerAvatar={owner?.avatar_url}
            isOverdue={isOverdue}
            onLocationUpdate={(lat, lng) => {
              setCheckin(prev => prev ? { ...prev, latitude: lat, longitude: lng, location_updated_at: new Date().toISOString() } : null);
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center h-full bg-dark-800">
            <div className="text-center">
              <MapPin className="w-10 h-10 text-dark-500 mx-auto mb-3" />
              <p className="text-dark-400">Waiting for location...</p>
              <p className="text-xs text-dark-500 mt-1">Location will appear once shared</p>
            </div>
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="relative z-20 border-t border-white/10 bg-dark-950/95 backdrop-blur-lg"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="p-4">
          {/* User info */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden border-2 border-primary-500/30">
              {owner?.avatar_url ? (
                <img src={owner.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-6 h-6 text-primary-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white">{owner?.full_name || "User"}</p>
              <p className="text-xs text-dark-400">
                Sharing location since {formatDistanceToNow(new Date(checkin.created_at), { addSuffix: true })}
              </p>
            </div>
            <div className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
              isOverdue
                ? "bg-red-500/15 text-red-400 border border-red-500/20"
                : "bg-green-500/15 text-green-400 border border-green-500/20"
            }`}>
              {checkin.status === "missed" ? "Missed" : "Active"}
            </div>
          </div>

          {/* Status row */}
          <div className="flex items-center gap-4 text-sm">
            {/* Timer */}
            <div className="flex items-center gap-1.5">
              <Clock className={`w-4 h-4 ${isOverdue ? "text-red-400" : "text-dark-400"}`} />
              <span className={isOverdue ? "text-red-400 font-medium" : "text-dark-300"}>
                {isOverdue ? "Check-in overdue" : `Next check-in: ${timeLeft}`}
              </span>
            </div>

            {/* Last confirmed */}
            {checkin.last_confirmed_at && (
              <div className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-dark-500" />
                <span className="text-dark-500 text-xs">
                  OK {formatDistanceToNow(new Date(checkin.last_confirmed_at), { addSuffix: true })}
                </span>
              </div>
            )}
          </div>

          {/* Location info */}
          {checkin.address && (
            <div className="flex items-center gap-1.5 mt-2">
              <MapPin className="w-3.5 h-3.5 text-dark-500 shrink-0" />
              <span className="text-xs text-dark-500 truncate">{checkin.address}</span>
            </div>
          )}

          {/* Location freshness */}
          {checkin.location_updated_at && (
            <p className="text-[11px] text-dark-600 mt-1">
              Location updated {formatDistanceToNow(new Date(checkin.location_updated_at), { addSuffix: true })}
            </p>
          )}

          {/* Missed check-in warning */}
          {checkin.status === "missed" && (
            <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400 font-medium mb-1">
                {owner?.full_name || "This person"} missed their check-in
              </p>
              <p className="text-xs text-dark-400">
                Do not panic. They may have forgotten or may not be near their phone. Try reaching out to them or someone nearby to confirm they are safe. If there is no response, escalate accordingly. Their location is still being shared.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}