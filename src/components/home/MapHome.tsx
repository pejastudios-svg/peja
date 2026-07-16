"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MapGL, { Marker, MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { CIRCLE_REFRESH_EVENT } from "@/lib/authFetch";
import { BADGE_MIN_KMH, SPEEDING_KMH, createMotionTracker, stillLabel } from "@/lib/motion";
import { createPositionFilter } from "@/lib/positionFilter";
import { batteryPct } from "@/lib/battery";
import { openDirections } from "@/lib/directions";
import { setAppBadgeCount } from "@/lib/appBadge";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { CommunityNudge } from "@/components/community/CommunityNudge";
import { CircleSheet, type CircleMember, type NearbyIncident } from "./CircleSheet";
import { TweenedMarker } from "./TweenedMarker";
import { MemberCard } from "./MemberCard";
import { StoryRail } from "./StoryRail";
import { authFetchJson } from "@/lib/authFetch";
import { CATEGORIES } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { Bell, BarChart3, Compass, LocateFixed, MapPin, Navigation, Radio, User, X } from "lucide-react";
import dynamic from "next/dynamic";

const DataAnalyticsPanel = dynamic(() => import("@/components/map/DataAnalyticsPanel"), { ssr: false });

// Lagos: sensible fallback center until we know where the user is.
const FALLBACK = { lat: 6.5244, lng: 3.3792 };
const REFRESH_MS = 45_000;
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`;

const SEVERITY_COLOR: Record<string, string> = {
  danger: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
  awareness: "#8b5cf6",
};

function freshness(capturedAt: string): { label: string; tier: "fresh" | "stale" | "cold" } {
  const age = Date.now() - new Date(capturedAt).getTime();
  if (age < 90_000) return { label: "now", tier: "fresh" };
  if (age < 60 * 60_000) return { label: `${Math.max(1, Math.round(age / 60_000))}m`, tier: "fresh" };
  if (age < 24 * 60 * 60_000) return { label: `${Math.round(age / 3_600_000)}h`, tier: "stale" };
  return { label: "over a day", tier: "cold" };
}

export default function MapHome() {
  const router = useRouter();
  const { user } = useAuth();
  const mapRef = useRef<MapRef>(null);

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  // Open the map where the user actually IS: last session's center from
  // localStorage immediately, then a one-time flyTo on the first live fix.
  const [initialView] = useState<{ lat: number; lng: number; known: boolean }>(() => {
    try {
      const v = localStorage.getItem("peja-map-center");
      if (v) {
        const p = JSON.parse(v);
        if (Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) return { lat: p.lat, lng: p.lng, known: true };
      }
    } catch {}
    return { ...FALLBACK, known: false };
  });
  const didCenterOnUser = useRef(false);
  const centerOnUserOnce = useCallback((lat: number, lng: number) => {
    if (didCenterOnUser.current) return;
    didCenterOnUser.current = true;
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 700 });
  }, []);
  // Always-fresh copy of `center` for use inside the load() closure (which
  // is memoized on [user] and otherwise can't see live position updates).
  const centerRef = useRef<{ lat: number; lng: number } | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [incidents, setIncidents] = useState<NearbyIncident[]>([]);
  const [circleSos, setCircleSos] = useState<
    { user_id: string; name: string; lat: number | null; lng: number | null; created_at: string; sosId: string }[]
  >([]);
  const [beacon, setBeacon] = useState<{ lat: number; lng: number; online: boolean } | null>(null);
  const [selectedMember, setSelectedMember] = useState<CircleMember | null>(null);
  const [sheetCircles, setSheetCircles] = useState<{ id: string; name: string; members: CircleMember[]; owned: boolean }[]>([]);
  const [incomingPing, setIncomingPing] = useState<
    { id: string; fromId: string; fromName: string } | null
  >(null);
  const [replyingOk, setReplyingOk] = useState(false);
  // Movement trails for active SOS pins (last 5 positions, oldest faintest)
  const [trails, setTrails] = useState<Record<string, { lat: number; lng: number }[]>>({});
  const [compassOn, setCompassOn] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sheetLiveTop, setSheetLiveTop] = useState<number | null>(null);
  // ── motion: my own speed / heading / stillness, from the GPS watcher ──
  const [motion, setMotion] = useState<{ speedKmh: number | null; heading: number | null; stillSince: string | null }>({ speedKmh: null, heading: null, stillSince: null });
  const [speedWarn, setSpeedWarn] = useState<number | null>(null);
  const [mapBearing, setMapBearing] = useState(0);
  const [mapZoom, setMapZoom] = useState(13);
  // Compass heading (deviceorientation) for the radar cone while still;
  // GPS course takes over once moving. Throttled: orientation events fire
  // at ~60Hz and would re-render the whole map.
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const compassThrottle = useRef({ t: 0, v: -999 });
  // Unwrapped (continuous) cone angle: instead of snapping 359 -> 1 and
  // letting CSS spin the long way round, accumulate the shortest-path
  // delta so every turn animates the way you actually turned.
  const coneRot = useRef<number | null>(null);
  const motionTracker = useRef(createMotionTracker());
  const posFilter = useRef(createPositionFilter());
  const lastPresenceWrite = useRef(0);
  // ── long-press pin: hold the map, get a place + directions ──
  const [pin, setPin] = useState<{ lat: number; lng: number; name: string | null; loading: boolean } | null>(null);
  // A flight requested before the map finished loading (deep link).
  const pendingFly = useRef<{ lat: number; lng: number } | null>(null);

  // Deep link from post cards: /?flyto=lat,lng&label=... drops the pin
  // card (name + directions) on the incident and flies there.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const flyto = params.get("flyto");
      if (!flyto) return;
      const [latS, lngS] = flyto.split(",");
      const lat = Number(latS);
      const lng = Number(lngS);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const label = params.get("label");
      setPin({ lat, lng, name: label || null, loading: false });
      didCenterOnUser.current = true; // the deep link owns the camera
      pendingFly.current = { lat, lng };
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 900 });
      // Clean the URL so refresh/back doesn't replay the flight.
      window.history.replaceState({}, "", "/");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  const cancelPress = useCallback(() => {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  }, []);

  const startPress = useCallback((x: number, y: number, lat: number, lng: number) => {
    cancelPress();
    press.current = {
      x,
      y,
      timer: setTimeout(() => {
        press.current = null;
        if (navigator.vibrate) navigator.vibrate(35);
        setPin({ lat, lng, name: null, loading: true });
        // Name the spot (MapTiler reverse geocoding, same key as the map).
        fetch(
          `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}&limit=1`
        )
          .then((r) => r.json())
          .then((d) => {
            const name = d?.features?.[0]?.place_name ?? null;
            setPin((prev) =>
              prev && prev.lat === lat && prev.lng === lng ? { ...prev, name, loading: false } : prev
            );
          })
          .catch(() => {
            setPin((prev) =>
              prev && prev.lat === lat && prev.lng === lng ? { ...prev, loading: false } : prev
            );
          });
      }, 550),
    };
  }, [cancelPress]);

  const movePress = useCallback((x: number, y: number) => {
    if (press.current && Math.hypot(x - press.current.x, y - press.current.y) > 10) {
      cancelPress();
    }
  }, [cancelPress]);

  // Unread notifications badge on the bell (same source as the feed
  // header). Polls gently + refreshes on focus and circle mutations.
  useEffect(() => {
    if (!user) return;
    let stop = false;
    const fetchUnread = async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      if (!stop && !error) {
        setUnreadCount(count || 0);
        setAppBadgeCount(count || 0);
      }
    };
    fetchUnread();
    const t = setInterval(fetchUnread, 30_000);
    window.addEventListener("focus", fetchUnread);
    return () => {
      stop = true;
      clearInterval(t);
      window.removeEventListener("focus", fetchUnread);
    };
  }, [user]);

  // Re-render every 30s so "Here for Xm" labels age in place.
  const [, setLabelTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLabelTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const flyTo = useCallback((lat: number, lng: number, zoom = 15) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 900 });
  }, []);

  // ── Own position: GPS first, own presence row as fallback (S5 handling) ──
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const fromPresence = async () => {
      const { data } = await supabase
        .from("presence")
        .select("lat, lng")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && data) { const c = { lat: data.lat, lng: data.lng }; centerRef.current = c; setCenter(c); centerOnUserOnce(c.lat, c.lng); }
    };

    // watchPosition (foreground only - this screen unmounts on nav away):
    // your own dot moves WITH you, tweened, no jumps.
    let watchId: number | null = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!cancelled) {
            setGpsDenied(false);

            // ── position filter: junk fixes (cell-tower fallbacks, GPS
            // teleports) never reach the map, the motion engine, or the
            // database. This is what keeps the dot from jumping around
            // in weak-GPS areas. ──
            const f = posFilter.current(pos);
            if (!f) return;
            const c = { lat: f.lat, lng: f.lng };
            centerRef.current = c;
            setCenter(c);
            centerOnUserOnce(c.lat, c.lng);
            try {
              localStorage.setItem("peja-map-center", JSON.stringify(c));
              // Live proof that location permission works (the welcome
              // card reads this instead of guessing from the flaky
              // Permissions API, which Safari half-supports).
              sessionStorage.setItem("peja-gps-ok", String(Date.now()));
            } catch {}

            // Motion engine consumes the FILTERED coordinates so speed
            // and stillness are computed from clean positions.
            const filteredPos = {
              coords: {
                ...pos.coords,
                latitude: f.lat,
                longitude: f.lng,
                accuracy: f.accuracyM,
              },
              timestamp: pos.timestamp,
            } as GeolocationPosition;
            const m = motionTracker.current(filteredPos);
            setMotion({ speedKmh: m.speedKmh, heading: m.heading, stillSince: m.stillSince });
            if (m.speedingTrigger && m.speedKmh != null) {
              const kmh = Math.round(m.speedKmh);
              setSpeedWarn(kmh);
              if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
              setTimeout(() => setSpeedWarn(null), 10_000);
              // Fan out to my circle (server enforces its own cooldown).
              authFetchJson("/api/motion/speeding", {
                method: "POST",
                body: JSON.stringify({ speed_kmh: kmh }),
              }).catch(() => {});
            }

            // ── live presence writer: 10s cadence while moving, 60s while
            // still, so viewers' speed badges stay honest. Ambient
            // PresenceCapture (5-min gap) stays the app-wide fallback. ──
            const moving = (m.speedKmh ?? 0) >= 5;
            const gap = moving ? 10_000 : 60_000;
            if (Date.now() - lastPresenceWrite.current > gap) {
              lastPresenceWrite.current = Date.now();
              batteryPct().then((battery) =>
                supabase.from("presence").upsert({
                  user_id: user.id,
                  lat: c.lat,
                  lng: c.lng,
                  accuracy_m: Math.round(f.accuracyM),
                  battery_pct: battery,
                  speed_kmh: m.speedKmh != null ? Math.round(m.speedKmh * 10) / 10 : null,
                  heading: m.heading,
                  still_since: m.stillSince,
                  captured_at: new Date().toISOString(),
                }).then(() => {})
              );
            }
          }
        },
        () => {
          if (!cancelled) {
            setGpsDenied(true);
            fromPresence();
          }
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 }
      );
    } else {
      setGpsDenied(true);
      fromPresence();
    }
    return () => {
      cancelled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, [user]);

  // ── Circle + incidents, polled while the screen lives ──
  useEffect(() => {
    if (!user) return;
    let stop = false;

    const load = async () => {
      // People I protect (their rows: owner = them, protector = me)...
      const [protectedRes, sharedBackRes] = await Promise.all([
        supabase
          .from("emergency_contacts")
          .select("user_id")
          .eq("contact_user_id", user.id)
          .eq("status", "accepted")
          .eq("hide_from_contact", false),
        // ...plus my protectors who shared their location back with me.
        supabase
          .from("emergency_contacts")
          .select("contact_user_id")
          .eq("user_id", user.id)
          .eq("status", "accepted")
          .eq("share_back", true),
      ]);
      const ids = [
        ...new Set([
          ...(protectedRes.data || []).map((r) => r.user_id as string),
          ...(sharedBackRes.data || []).map((r) => r.contact_user_id as string),
        ]),
      ].filter((id) => id !== user.id);

      if (stop) return;

      let outMembers: CircleMember[] = [];
      if (ids.length === 0) {
        setMembers([]);
        setCircleSos([]);
      } else {
        const [usersRes, presenceRes, sosRes, smlRes] = await Promise.all([
          supabase.from("users").select("id, full_name, avatar_url").in("id", ids),
          supabase.from("presence").select("*").in("user_id", ids),
          supabase
            .from("sos_alerts")
            .select("id, user_id, latitude, longitude, created_at")
            .eq("status", "active")
            .in("user_id", ids),
          // Live SML sessions shared with me (sharers are always people I
          // protect, so they're already in `ids`).
          supabase
            .from("safety_checkins")
            .select("user_id, latitude, longitude, status, next_check_in_at, speed_kmh, still_since")
            .in("status", ["active", "missed"])
            .contains("contact_ids", [user.id]),
        ]);
        if (stop) return;

        const presenceById = new Map((presenceRes.data || []).map((p) => [p.user_id, p]));
        const sosById = new Map((sosRes.data || []).map((s) => [s.user_id, s]));
        const smlById = new Map((smlRes.data || []).map((c) => [c.user_id, c]));

        const out: CircleMember[] = (usersRes.data || []).map((u) => {
          const p = presenceById.get(u.id);
          const sos = sosById.get(u.id);
          const sml = smlById.get(u.id);
          const f = p ? freshness(p.captured_at) : null;
          const smlOverdue = Boolean(
            sml &&
              (sml.status === "missed" ||
                (sml.next_check_in_at && new Date(sml.next_check_in_at).getTime() < Date.now()))
          );
          // Speed is only honest when the fix is fresh: live SML data
          // always qualifies; ambient presence must be under 2 minutes old.
          const presenceFresh = p && Date.now() - new Date(p.captured_at).getTime() < 120_000;
          const speedKmh = sml?.speed_kmh ?? (presenceFresh ? p?.speed_kmh ?? null : null);
          const stillSince = sml?.still_since ?? p?.still_since ?? null;
          return {
            id: u.id,
            name: u.full_name || "Unknown",
            avatar: u.avatar_url || null,
            lat: sos?.latitude ?? sml?.latitude ?? p?.lat ?? null,
            lng: sos?.longitude ?? sml?.longitude ?? p?.lng ?? null,
            freshLabel: sos || sml ? "live" : f?.label ?? null,
            tier: sos || sml ? "fresh" : f?.tier ?? "cold",
            sosActive: Boolean(sos),
            smlActive: Boolean(sml),
            smlOverdue,
            batteryPct: p?.battery_pct ?? null,
            speedKmh,
            stillSince,
            // Honesty: how coarse is the fix behind this dot? Live SOS/SML
            // positions are treated as good; ambient falls back to the
            // presence row's reported accuracy.
            accuracyM: sos || sml ? null : p?.accuracy_m ?? null,
          };
        });
        out.sort((a, b) => Number(b.sosActive) - Number(a.sosActive));
        outMembers = out;
        setMembers(out);
        setCircleSos(
          (sosRes.data || []).map((s) => ({
            user_id: s.user_id,
            name: (usersRes.data || []).find((u) => u.id === s.user_id)?.full_name || "Someone",
            lat: s.latitude,
            lng: s.longitude,
            created_at: s.created_at,
            sosId: s.id,
          }))
        );
      }

      // My circles for the sheet: ones I OWN plus ones I'm an accepted
      // MEMBER of. Accepted members only; members without map visibility
      // still get a row (cold tier) so they can be pinged.
      const [ownedRes, memberRes] = await Promise.all([
        supabase
          .from("contact_groups")
          .select("id, name, owner_id, contact_group_members(member_user_id, status)")
          .eq("owner_id", user.id),
        supabase
          .from("contact_group_members")
          .select("status, contact_groups(id, name, owner_id, contact_group_members(member_user_id, status))")
          .eq("member_user_id", user.id)
          .eq("status", "accepted"),
      ]);
      if (!stop) {
        const rawGroups = [
          ...(ownedRes.data || []),
          ...((memberRes.data || [])
            .map((r) => r.contact_groups)
            .filter(Boolean) as unknown as {
            id: string; name: string; owner_id: string;
            contact_group_members: { member_user_id: string; status: string }[];
          }[]),
        ];
        // De-dupe by id (a circle I both own and... can't, but be safe).
        const seen = new Set<string>();
        const defs = rawGroups
          .filter((g) => g && !seen.has(g.id) && seen.add(g.id))
          .map((g) => ({
            id: g.id,
            name: g.name,
            owned: g.owner_id === user.id,
            memberIds: [
              ...new Set([
                g.owner_id, // the creator is part of the circle
                ...((g.contact_group_members as { member_user_id: string; status: string }[]) || [])
                  .filter((m) => m.status === "accepted")
                  .map((m) => m.member_user_id),
              ]),
            ],
          }));
        const knownById = new Map(outMembers.map((m) => [m.id, m]));
        const extraIds = [
          ...new Set(defs.flatMap((d) => d.memberIds).filter((id) => !knownById.has(id) && id !== user.id)),
        ];
        const extraById = new Map<string, { full_name: string | null; avatar_url: string | null }>();
        if (extraIds.length > 0) {
          const { data: extra } = await supabase
            .from("users")
            .select("id, full_name, avatar_url")
            .in("id", extraIds);
          for (const u of extra || []) extraById.set(u.id, u);
        }
        const selfPos = centerRef.current;
        const selfMember: CircleMember = {
          id: user.id,
          name: `${user.full_name || "You"} (You)`,
          avatar: user.avatar_url || null,
          lat: selfPos?.lat ?? null,
          lng: selfPos?.lng ?? null,
          freshLabel: selfPos ? "now" : null,
          tier: selfPos ? "fresh" : "cold",
          sosActive: false,
          smlActive: false,
          smlOverdue: false,
          batteryPct: null,
        };
        setSheetCircles(
          defs
            .filter((d) => d.memberIds.length > 0)
            .map((d) => ({
              id: d.id,
              name: d.name,
              owned: d.owned,
              members: d.memberIds.map((id) =>
                id === user.id
                  ? selfMember
                  : knownById.get(id) ?? {
                      id,
                      name: extraById.get(id)?.full_name || "Unknown",
                      avatar: extraById.get(id)?.avatar_url || null,
                      lat: null,
                      lng: null,
                      freshLabel: null,
                      tier: "cold" as const,
                      sosActive: false,
                      smlActive: false,
                      smlOverdue: false,
                      batteryPct: null,
                    }
              ),
            }))
        );
      }

      // Own Beacon tracker pin (owner-only on home, per design D5).
      const { data: dev } = await supabase
        .from("devices")
        .select("last_lat, last_lng, status")
        .eq("user_id", user.id)
        .neq("status", "unpaired")
        .not("last_lat", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!stop) {
        setBeacon(
          dev ? { lat: dev.last_lat, lng: dev.last_lng, online: dev.status === "connected" } : null
        );
      }

      // Latest live incidents with coordinates (marker budget: 50).
      const { data: posts } = await supabase
        .from("posts")
        .select("id, category, latitude, longitude, created_at, address")
        .in("status", ["live", "resolved"])
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!stop && posts) {
        setIncidents(
          posts.map((p) => ({
            id: p.id,
            category: p.category,
            lat: p.latitude,
            lng: p.longitude,
            createdAt: p.created_at,
            address: p.address || null,
          }))
        );
      }
    };

    load();
    const t = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    // Instant refetch when a circle mutation happens anywhere in the app
    // (add, accept, remove) instead of waiting out the ambient poll.
    window.addEventListener(CIRCLE_REFRESH_EVENT, onFocus);
    return () => {
      stop = true;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(CIRCLE_REFRESH_EVENT, onFocus);
    };
  }, [user]);


  // Passive device-orientation listener for the radar cone. On iOS this
  // stays silent until the user grants motion permission via the compass
  // button; the cone then falls back to GPS course while driving.
  useEffect(() => {
    // Android's plain deviceorientation is often RELATIVE (arbitrary zero,
    // drifts) - that's why turns looked wrong. deviceorientationabsolute
    // gives a true compass frame; iOS keeps webkitCompassHeading. Devices
    // with neither show no beam while standing (GPS course covers moving).
    const useAbs = "ondeviceorientationabsolute" in window;
    const evName = useAbs ? "deviceorientationabsolute" : "deviceorientation";
    const onOrient = (e: DeviceOrientationEvent) => {
      const webkit = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      let h: number | null = null;
      if (webkit != null && !Number.isNaN(webkit)) {
        h = webkit;
      } else if (e.alpha != null && (useAbs || e.absolute === true)) {
        // alpha is CCW from north; compensate for screen rotation.
        const ang = typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle || 0 : 0;
        h = (360 - e.alpha + ang + 360) % 360;
      }
      if (h == null || Number.isNaN(h)) return;
      const now = Date.now();
      const { t, v } = compassThrottle.current;
      // Light circular smoothing kills hand jitter without adding lag.
      const prev = v === -999 ? h : v;
      const delta = ((h - prev + 540) % 360) - 180;
      const smoothed = (prev + delta * 0.35 + 360) % 360;
      if (now - t > 100 && Math.abs(((smoothed - v + 540) % 360) - 180) > 1) {
        compassThrottle.current = { t: now, v: smoothed };
        setCompassHeading(smoothed);
      } else {
        compassThrottle.current = { t, v: smoothed };
      }
    };
    window.addEventListener(evName, onOrient, true);
    return () => window.removeEventListener(evName, onOrient, true);
  }, []);

  // ── Compass mode: rotate the map to match which way the phone points.
  // Needs the device-orientation permission on iOS. Off = snap to north. ──
  useEffect(() => {
    if (!compassOn) {
      mapRef.current?.getMap().easeTo({ bearing: 0, duration: 400 });
      return;
    }
    let lastEase = 0;
    const onOrient = (e: DeviceOrientationEvent) => {
      // webkitCompassHeading (iOS) is true heading; alpha is 0=north CCW.
      const heading =
        (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading ??
        (e.alpha != null ? 360 - e.alpha : null);
      if (heading == null) return;
      // Ease the map instead of snapping it: slight head movements used
      // to yank the whole world around. Throttled + minimum meaningful
      // turn + a smooth 400ms glide.
      const map = mapRef.current?.getMap();
      if (!map) return;
      const now = Date.now();
      const current = map.getBearing();
      const d = ((heading - current + 540) % 360) - 180;
      if (now - lastEase < 250 || Math.abs(d) < 2) return;
      lastEase = now;
      map.easeTo({ bearing: current + d, duration: 400 });
    };
    window.addEventListener("deviceorientation", onOrient, true);
    return () => window.removeEventListener("deviceorientation", onOrient, true);
  }, [compassOn]);

  const toggleCompass = useCallback(async () => {
    if (compassOn) { setCompassOn(false); return; }
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE?.requestPermission === "function") {
      try {
        if ((await DOE.requestPermission()) !== "granted") return;
      } catch { return; }
    }
    setCompassOn(true);
  }, [compassOn]);

  // ── SOS fast lane: while a circle SOS is active, positions refresh
  // every 10s (vs 45s ambient) and leave a short fading trail so
  // responders can read the direction of movement. ──
  useEffect(() => {
    if (!user || circleSos.length === 0) return;
    const ids = circleSos.map((c) => c.user_id);
    const t = setInterval(async () => {
      const { data } = await supabase
        .from("sos_alerts")
        .select("user_id, latitude, longitude, created_at")
        .eq("status", "active")
        .in("user_id", ids);
      if (!data) return;
      setTrails((prev) => {
        const next = { ...prev };
        for (const d of data) {
          if (d.latitude == null) continue;
          const tr = next[d.user_id] ?? [];
          const last = tr[tr.length - 1];
          if (!last || last.lat !== d.latitude || last.lng !== d.longitude) {
            next[d.user_id] = [...tr, { lat: d.latitude, lng: d.longitude }].slice(-5);
          }
        }
        return next;
      });
      setMembers((prev) =>
        prev.map((m) => {
          const f = data.find((d) => d.user_id === m.id);
          return f && f.latitude != null ? { ...m, lat: f.latitude, lng: f.longitude } : m;
        })
      );
      setCircleSos((prev) =>
        prev
          .filter((p) => data.some((d) => d.user_id === p.user_id))
          .map((p) => {
            const f = data.find((d) => d.user_id === p.user_id);
            return f && f.latitude != null ? { ...p, lat: f.latitude, lng: f.longitude } : p;
          })
      );
    }, 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, circleSos.length]);

  // ── Incoming "are you okay?" pings -> the I'm OK banner ──
  useEffect(() => {
    if (!user) return;
    let stop = false;
    const check = async () => {
      // Keyed on data.answered (set by the I'm OK tap), NOT is_read -
      // merely seeing the push notification must not hide the banner.
      // Pings older than an hour expire quietly.
      const { data } = await supabase
        .from("notifications")
        .select("id, data")
        .eq("user_id", user.id)
        .filter("data->>type", "eq", "community_ping")
        .filter("data->>answered", "is", null)
        .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      if (stop) return;
      const n = data?.[0];
      setIncomingPing(
        n
          ? {
              id: n.id,
              fromId: (n.data?.from_user_id as string) || "",
              fromName: (n.data?.from_name as string) || "Someone",
            }
          : null
      );
    };
    check();
    const t = setInterval(check, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, [user]);

  const replyImOk = async () => {
    if (!incomingPing || replyingOk) return;
    setReplyingOk(true);
    try {
      if (incomingPing.fromId) {
        await authFetchJson("/api/community/ping", {
          method: "POST",
          body: JSON.stringify({ peerId: incomingPing.fromId, mode: "imok" }),
        });
      }
      // Merge answered into data so the banner logic (and any other
      // device polling) sees this ping as handled forever.
      const { data: row } = await supabase
        .from("notifications")
        .select("data")
        .eq("id", incomingPing.id)
        .maybeSingle();
      await supabase
        .from("notifications")
        .update({ is_read: true, data: { ...(row?.data ?? {}), answered: true } })
        .eq("id", incomingPing.id);
      setIncomingPing(null);
      if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
    } finally {
      setReplyingOk(false);
    }
  };

  // How open the sheet is RIGHT NOW (0 collapsed .. 1 expanded), live
  // during drags so dependent UI moves with the finger, not after snap.
  const sheetOpenness = (() => {
    if (typeof window === "undefined") return sheetExpanded ? 1 : 0;
    const expandedTop = 62 + Math.min(window.innerHeight * 0.62, 520);
    const t = sheetLiveTop != null ? sheetLiveTop : sheetExpanded ? expandedTop : 158;
    return Math.min(1, Math.max(0, (t - 158) / Math.max(1, expandedTop - 158)));
  })();
  // With a pin card stacked over the sheet, the back layer (header chips,
  // story rail) fades up and out as the sheet rises.
  const topFade = pin ? sheetOpenness : 0;
  // visibility is a discrete property: without its own delayed transition
  // it flips instantly on a tap-open (state snap) and yanks the elements
  // before the fade can play. Delay hiding until the fade completes;
  // showing flips immediately so the fade-in is visible.
  const topFadeStyle: React.CSSProperties = {
    opacity: 1 - topFade,
    transform: `translateY(${-28 * topFade}px)`,
    transition:
      sheetLiveTop != null
        ? "none"
        : `opacity 0.45s cubic-bezier(0.32, 0.72, 0, 1), transform 0.45s cubic-bezier(0.32, 0.72, 0, 1), visibility 0s linear ${topFade > 0.97 ? "0.45s" : "0s"}`,
    visibility: topFade > 0.97 ? ("hidden" as const) : ("visible" as const),
  };

  const initials = (user?.full_name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const categoryColor = (cid: string) =>
    SEVERITY_COLOR[CATEGORIES.find((c) => c.id === cid)?.color || "info"];

  const activeSos = circleSos[0] ?? null;

  return (
    <div className="fixed inset-0 bg-dark-950">
      <MapGL
        ref={mapRef}
        initialViewState={{ latitude: initialView.lat, longitude: initialView.lng, zoom: initialView.known ? 15 : 12 }}
        mapStyle={MAP_STYLE}
        attributionControl={false}
        style={{ width: "100%", height: "100%" }}
        onRotate={(e) => setMapBearing(e.viewState.bearing)}
        onLoad={() => {
          if (pendingFly.current) {
            const { lat, lng } = pendingFly.current;
            pendingFly.current = null;
            mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 900 });
          }
        }}
        onMouseDown={(e) => startPress(e.point.x, e.point.y, e.lngLat.lat, e.lngLat.lng)}
        onMouseMove={(e) => movePress(e.point.x, e.point.y)}
        onMouseUp={cancelPress}
        onTouchStart={(e) => startPress(e.point.x, e.point.y, e.lngLat.lat, e.lngLat.lng)}
        onTouchMove={(e) => movePress(e.point.x, e.point.y)}
        onTouchEnd={cancelPress}
        onMove={(e) => {
          cancelPress();
          setMapZoom(Math.round(e.viewState.zoom * 10) / 10);
        }}
      >
        {/* ── you: the protagonist bubble (Life360-style, with tail) ── */}
        {center && (() => {
          // Radar cone: GPS course while driving, compass while standing.
          // Subtract the map bearing so it stays geographically true when
          // compass mode rotates the map.
          const rawHeading = motion.heading ?? compassHeading;
          let coneDeg: number | null = null;
          if (rawHeading != null) {
            const target = rawHeading - mapBearing;
            if (coneRot.current == null) {
              coneRot.current = target;
            } else {
              // shortest-path accumulate (idempotent when target repeats)
              const d = ((target - coneRot.current) % 360 + 540) % 360 - 180;
              coneRot.current += d;
            }
            coneDeg = coneRot.current;
          }
          const idle = (motion.speedKmh ?? 0) < 2;
          const kmh = motion.speedKmh != null ? Math.round(motion.speedKmh) : null;
          return (
          <TweenedMarker latitude={center.lat} longitude={center.lng} anchor="bottom">
            <div className="relative flex flex-col items-center pointer-events-none">
              <style>{`@keyframes ownIdleFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }`}</style>
              {/* accuracy/ambient halo behind everything */}
              <div className="absolute bottom-[-14px] w-20 h-20 rounded-full bg-primary-500/15 beacon-radar-ring" />
              <div className="relative" style={idle ? { animation: "ownIdleFloat 3.4s ease-in-out infinite" } : undefined}>
                {/* view beam (Google Maps style): emanates from the CENTER
                    of your avatar, behind it, rotating as you turn */}
                {coneDeg != null && (
                  <svg
                    viewBox="0 0 100 100"
                    className="absolute left-1/2 top-1/2 w-[200px] h-[200px] pointer-events-none"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${coneDeg}deg)`,
                      transition: "transform 0.35s ease-out",
                    }}
                    aria-hidden
                  >
                    <defs>
                      <radialGradient id="peja-cone" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(139,92,246,0.55)" />
                        <stop offset="55%" stopColor="rgba(139,92,246,0.22)" />
                        <stop offset="100%" stopColor="rgba(139,92,246,0)" />
                      </radialGradient>
                    </defs>
                    <path d="M50 50 L26 4 A52 52 0 0 1 74 4 Z" fill="url(#peja-cone)" />
                  </svg>
                )}
                <div className="relative z-10 w-[52px] h-[52px] rounded-2xl border-[3px] border-white bg-primary-600 shadow-[0_4px_16px_rgba(0,0,0,0.4)] flex items-center justify-center overflow-hidden">
                  {user?.avatar_url ? (
                    <AvatarImage src={user.avatar_url} wrapperClassName="w-full h-full" />
                  ) : (
                    <span className="text-white font-bold text-lg">{initials}</span>
                  )}
                </div>
                {/* tail: makes the bubble point at the exact spot */}
                <div
                  className="absolute z-10 left-1/2 -translate-x-1/2 -bottom-[7px] w-3.5 h-3.5 rotate-45 bg-primary-600 border-b-[3px] border-r-[3px] border-white"
                  style={{ borderBottomRightRadius: 4 }}
                />
              </div>
              {/* live speed while driving; "Here for Xm" while parked */}
              {kmh != null && kmh >= BADGE_MIN_KMH ? (
                <span
                  className={`mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold shadow text-white ${
                    kmh > SPEEDING_KMH ? "bg-red-600" : "bg-black/75"
                  }`}
                >
                  {kmh} km/h
                </span>
              ) : (
                stillLabel(motion.stillSince) && (
                  <span className="mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold shadow bg-black/75 text-white">
                    {stillLabel(motion.stillSince)}
                  </span>
                )
              )}
              <div className="h-2.5" />
            </div>
          </TweenedMarker>
          );
        })()}

        {/* ── your circle ── */}
        {members
          .filter((m) => m.lat != null && m.lng != null && m.tier !== "cold")
          .map((m) => (
            <TweenedMarker key={m.id} latitude={m.lat as number} longitude={m.lng as number} anchor="bottom">
              <button
                onClick={() => {
                  if (m.sosActive) {
                    const sos = circleSos.find((c) => c.user_id === m.id);
                    if (sos) { router.push(`/map?sos=${sos.sosId}`); return; }
                  }
                  flyTo(m.lat as number, m.lng as number);
                  setSelectedMember(m);
                }}
                className="flex flex-col items-center active:scale-90 transition-transform"
              >
                {/* honesty halo: a coarse fix renders as "somewhere in this
                    area", sized to the REAL reported accuracy at the
                    current zoom, instead of a confidently wrong pin. */}
                {(m.accuracyM ?? 0) > 150 && (() => {
                  const mpp = (156543.03392 * Math.cos(((m.lat as number) * Math.PI) / 180)) / Math.pow(2, mapZoom);
                  const px = Math.min(320, Math.max(28, ((m.accuracyM as number) * 2) / mpp));
                  return (
                    <div
                      className="absolute rounded-full border border-primary-400/40 bg-primary-500/10 pointer-events-none"
                      style={{ width: px, height: px, bottom: 20 - px / 2, left: "50%", transform: "translateX(-50%)" }}
                    />
                  );
                })()}
                <div className="relative w-10 h-10">
                  {(m.sosActive || m.smlOverdue) && <div className="absolute -inset-1 rounded-full sos-glow-ring" />}
                  {!m.sosActive && !m.smlOverdue && m.smlActive && (
                    <div className="absolute -inset-1 rounded-full helper-glow-ring" />
                  )}
                  <div
                    className={`w-10 h-10 rounded-full border-[2.5px] overflow-hidden bg-dark-700 flex items-center justify-center ${
                      m.sosActive
                        ? "border-red-500"
                        : m.smlOverdue
                          ? "border-red-500 animate-pulse"
                          : m.smlActive
                            ? "border-green-400"
                            : m.tier === "fresh"
                              ? "border-white"
                              : "border-dark-500 opacity-75"
                    }`}
                  >
                    {m.avatar ? (
                      <AvatarImage src={m.avatar} wrapperClassName="w-full h-full" />
                    ) : (
                      <User className="w-5 h-5 text-dark-300" />
                    )}
                  </div>
                </div>
                <span
                  className={`mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold shadow ${
                    m.sosActive || m.smlOverdue || (m.speedKmh != null && m.speedKmh > SPEEDING_KMH)
                      ? "bg-red-600 text-white"
                      : "bg-black/70 text-white"
                  }`}
                >
                  {m.name.split(" ")[0]}
                  {(() => {
                    if (m.speedKmh != null && m.speedKmh >= BADGE_MIN_KMH) return ` · ${Math.round(m.speedKmh)} km/h`;
                    const still = stillLabel(m.stillSince);
                    if (still) return ` · ${still}`;
                    const approx = (m.accuracyM ?? 0) > 150 ? " · approx" : "";
                    return (m.freshLabel ? ` · ${m.freshLabel}` : "") + approx;
                  })()}
                </span>
              </button>
            </TweenedMarker>
          ))}

        {/* ── dropped pin (long-press) ── */}
        {pin && (
          <Marker latitude={pin.lat} longitude={pin.lng} anchor="bottom">
            <div className="relative flex flex-col items-center beacon-pop pointer-events-none">
              <div className="w-9 h-9 rounded-full bg-primary-600 border-[3px] border-white shadow-xl flex items-center justify-center">
                <MapPin className="w-4.5 h-4.5 text-white" fill="currentColor" stroke="#6d28d9" strokeWidth={1.5} />
              </div>
              <div className="w-1 h-2.5 bg-white rounded-b-full -mt-0.5 shadow" />
            </div>
          </Marker>
        )}

        {/* ── SOS movement trails (oldest faintest) ── */}
        {Object.entries(trails).flatMap(([uid, pts]) =>
          circleSos.some((c) => c.user_id === uid)
            ? pts.slice(0, -1).map((pt, i) => (
                <Marker key={`trail-${uid}-${i}`} latitude={pt.lat} longitude={pt.lng} anchor="center">
                  <span
                    className="block rounded-full bg-red-500 pointer-events-none"
                    style={{
                      width: 8 + i * 2,
                      height: 8 + i * 2,
                      opacity: 0.15 + i * 0.15,
                    }}
                  />
                </Marker>
              ))
            : []
        )}

        {/* ── your Beacon tracker (owner-only) ── */}
        {beacon && (
          <TweenedMarker latitude={beacon.lat} longitude={beacon.lng} anchor="center">
            <div
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shadow-lg ${
                beacon.online ? "bg-primary-600 border-white" : "bg-dark-700 border-dark-500 opacity-70"
              }`}
            >
              <Radio className="w-4 h-4 text-white" />
            </div>
          </TweenedMarker>
        )}

        {/* ── incidents ── */}
        {incidents.map((p) => (
          <Marker key={p.id} latitude={p.lat} longitude={p.lng} anchor="center">
            <button
              onClick={() => router.push(`/post/${p.id}`)}
              className="active:scale-75 transition-transform"
              aria-label="View incident"
            >
              <span className="relative block w-7 h-7">
                <span
                  className="absolute inset-0 rounded-full opacity-30"
                  style={{ background: categoryColor(p.category) }}
                />
                <span
                  className="absolute inset-1 rounded-full border-2 border-white shadow-lg"
                  style={{ background: categoryColor(p.category) }}
                />
              </span>
            </button>
          </Marker>
        ))}
      </MapGL>

      {/* ── floating top chips ── */}
      <div
        className="absolute left-0 right-0 flex items-center justify-between px-4 pointer-events-none"
        style={{ top: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 12px) + 8px)", ...topFadeStyle }}
      >
        <button
          onClick={() => router.push("/profile")}
          className="pointer-events-auto w-11 h-11 rounded-full overflow-hidden border border-white/20 shadow-lg bg-dark-800 active:scale-90 transition-transform"
          aria-label="Profile"
        >
          {user?.avatar_url ? (
            <AvatarImage src={user.avatar_url} wrapperClassName="w-full h-full" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-dark-100 font-bold text-sm">{initials}</span>
            </div>
          )}
        </button>
        <button
          onClick={() => router.push("/notifications")}
          className="pointer-events-auto relative w-11 h-11 rounded-full flex items-center justify-center border border-white/20 shadow-lg bg-dark-800 active:scale-90 transition-transform"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 text-dark-100" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold rounded-full px-1"
              style={{ background: "#ef4444", color: "white", boxShadow: "0 0 6px rgba(239,68,68,0.5)" }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* ── local-pulse story rail ── incidents + tips don't need GPS, so
          it shows even when location is off (just below that card). Only
          truly urgent, full-attention banners (SOS / ping) hide it. ── */}
      {!activeSos && !incomingPing && (
        <div
          className="absolute left-0 right-0"
          style={{
            top:
              gpsDenied && !center
                ? "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 12px) + 150px)"
                : "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 12px) + 60px)",
            ...topFadeStyle,
          }}
        >
          <StoryRail incidents={incidents} />
        </div>
      )}

      {/* ── map controls (sit above the sheet peek) ── */}
      {(() => {
        const dragging = sheetLiveTop != null;
        const ctlBottom = dragging
          ? `${sheetLiveTop + 12}px`
          : sheetExpanded
            ? "calc(env(safe-area-inset-bottom, 0px) + 62px + min(62vh, 520px) + 12px)"
            : "calc(env(safe-area-inset-bottom, 0px) + 170px)";
        // Same easing/duration as the sheet's snap, so on release they
        // glide together; disabled mid-drag so they track the finger 1:1.
        const ctlTransition = dragging
          ? "none"
          : "bottom 0.45s cubic-bezier(0.32, 0.72, 0, 1)";
        const surface: React.CSSProperties = {
          background: "var(--glass-float-bg)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-shadow-float)",
        };
        return (
          <>
            {/* left: area analytics */}
            <button
              onClick={() => setShowAnalytics(true)}
              aria-label="Area insights"
              className="absolute left-4 w-11 h-11 rounded-full flex items-center justify-center active:scale-90"
              // "transform 0.15s, none" is INVALID CSS (none can't join a
              // transition list); the browser silently kept the old 0.45s
              // bottom transition mid-drag, making this button lag behind
              // the others. Compose a valid value for each state instead.
              style={{
                bottom: ctlBottom,
                transition: dragging ? "transform 0.15s" : `transform 0.15s, ${ctlTransition}`,
                ...surface,
              }}
            >
              <BarChart3 className="beacon-accent-text w-5 h-5" />
            </button>

            {/* right stack: compass toggle + recenter */}
            <div className="absolute right-4 flex flex-col gap-2" style={{ bottom: ctlBottom, transition: ctlTransition }}>
              <button
                onClick={toggleCompass}
                aria-label="Compass"
                className={`w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform ${compassOn ? "bg-primary-600" : ""}`}
                style={compassOn ? { boxShadow: "var(--glass-shadow-float)" } : surface}
              >
                <Compass className={`w-5 h-5 ${compassOn ? "text-white" : "beacon-accent-text"}`} />
              </button>
              {center && (
                <button
                  onClick={() => flyTo(center.lat, center.lng, 14)}
                  aria-label="Center on me"
                  className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                  style={surface}
                >
                  <LocateFixed className="beacon-accent-text w-5 h-5" />
                </button>
              )}
            </div>

            {/* dropped-pin card: place name + directions */}
            {pin && (
              <div
                className="absolute"
                style={{
                  left: 72,
                  right: 72,
                  bottom: dragging ? `${sheetLiveTop + 12}px` : ctlBottom,
                  transition: dragging ? "none" : ctlTransition,
                }}
              >
                <div className="rounded-2xl glass-card !p-3 beacon-pop">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary-500/20 flex items-center justify-center shrink-0">
                      <MapPin className="beacon-accent-text w-[18px] h-[18px]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-dark-100 truncate">
                        {pin.loading ? "Finding this place..." : pin.name || "Dropped pin"}
                      </p>
                      <p className="text-xs text-dark-400 truncate">
                        {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                      </p>
                    </div>
                    <button
                      onClick={() => openDirections({ lat: pin.lat, lng: pin.lng }, centerRef.current)}
                      className="px-3.5 py-2 rounded-xl bg-primary-600 text-white text-xs font-semibold active:scale-95 transition-transform shrink-0 flex items-center gap-1.5"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      Directions
                    </button>
                    <button
                      onClick={() => setPin(null)}
                      aria-label="Remove pin"
                      className="p-1.5 rounded-full text-dark-400 hover:bg-white/10 active:scale-90 transition-all shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* S0 nudge: sheet open = compact row slotted BETWEEN the
                controls (left button 16+44, 12px gap = 72px insets);
                sheet closed = full-width detail card lifted above the
                right control stack. Same easing as the controls so all
                three move as one piece. */}
            {!activeSos && !incomingPing && (
              <div
                className="absolute"
                style={{
                  left: sheetExpanded ? 72 : 16,
                  right: sheetExpanded ? 72 : 16,
                  // Mid-drag: ride the live sheet edge in BOTH directions,
                  // keeping the full card's 108px lift above the control
                  // line (96px right stack + 12px gap) until release.
                  // Pin card owns the between-controls slot when present;
                  // the compact nudge stacks one row above it.
                  bottom: dragging
                    ? `${sheetLiveTop + 12 + (sheetExpanded ? (pin ? 72 : 0) : 108)}px`
                    : sheetExpanded
                      ? pin
                        ? `calc(${ctlBottom} + 72px)`
                        : ctlBottom
                      : "calc(env(safe-area-inset-bottom, 0px) + 278px)",
                  transition: dragging
                    ? "none"
                    : `left 0.45s cubic-bezier(0.32, 0.72, 0, 1), right 0.45s cubic-bezier(0.32, 0.72, 0, 1), ${ctlTransition}`,
                }}
              >
                <CommunityNudge compact={sheetExpanded} />
              </div>
            )}
          </>
        );
      })()}

      {/* ── S3: circle SOS banner ── */}
      {activeSos && (
        <button
          onClick={() => router.push(`/map?sos=${activeSos.sosId}`)}
          className="absolute left-4 right-4 rounded-2xl bg-red-600 text-white px-4 py-3 shadow-2xl beacon-step-in active:scale-[0.98] transition-transform"
          style={{ top: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 12px) + 64px)" }}
        >
          <p className="font-bold text-sm text-left">{activeSos.name} needs help</p>
          <p className="text-xs text-red-100 text-left">
            SOS · {formatDistanceToNow(new Date(activeSos.created_at), { addSuffix: true })} · tap to view
          </p>
        </button>
      )}

      {/* ── S5: location off ── */}
      {gpsDenied && !center && (
        <div
          className="absolute left-4 right-4 rounded-2xl glass-card !p-4 beacon-step-in"
          style={{ top: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 12px) + 64px)" }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
              <MapPin className="beacon-accent-text w-4.5 h-4.5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-dark-100">Location is off</p>
              <p className="text-xs text-dark-400">Turn it on so your people can find you.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── speeding popup: you, right now ── */}
      {speedWarn != null && (
        <div
          className="absolute left-4 right-4 rounded-2xl bg-red-600 text-white px-4 py-3 shadow-2xl beacon-step-in"
          style={{ top: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 12px) + 8px)", zIndex: 40 }}
        >
          <p className="text-sm font-bold">You are doing {speedWarn} km/h</p>
          <p className="text-xs text-red-100">Please slow down. Your people need you home.</p>
        </div>
      )}

      {/* ── incoming ping: the I'm OK banner ── */}
      {incomingPing && !activeSos && (
        <div
          className="absolute left-4 right-4 rounded-2xl glass-card !p-3.5 beacon-step-in"
          style={{ top: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 12px) + 64px)" }}
        >
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-dark-100">
                {incomingPing.fromName.split(" ")[0]} is checking on you
              </p>
              <p className="text-xs text-dark-400">One tap puts their mind at ease</p>
            </div>
            <button
              onClick={replyImOk}
              disabled={replyingOk}
              className="px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-bold active:scale-95 transition-transform disabled:opacity-60 shrink-0"
            >
              {replyingOk ? "..." : "I'm OK"}
            </button>
          </div>
        </div>
      )}

      {/* ── area analytics ── */}
      <DataAnalyticsPanel
        isOpen={showAnalytics}
        onClose={() => setShowAnalytics(false)}
        onSelectArea={(lat, lng) => { setShowAnalytics(false); flyTo(lat, lng, 14); }}
      />

      {/* ── member card ── */}
      <MemberCard member={selectedMember} onClose={() => setSelectedMember(null)} origin={center} />

      {/* ── the sheet ── */}
      <CircleSheet
        members={members}
        circles={sheetCircles}
        onExpandedChange={setSheetExpanded}
        onSheetMove={(top) => setSheetLiveTop(top)}
        incidents={incidents.slice(0, 5)}
        onMemberTap={(m) => {
          if (m.lat != null && m.lng != null) flyTo(m.lat, m.lng);
          setSelectedMember(m);
        }}
        onIncidentTap={(i) => router.push(`/post/${i.id}`)}
      />
    </div>
  );
}
