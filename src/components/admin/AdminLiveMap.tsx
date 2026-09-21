"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import MapGL, {
  Marker,
  Popup,
  NavigationControl,
  Source,
  Layer,
  MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { VoiceNotePlayer } from "@/components/messages/VoiceNotePlayer";
import { SOS_TAGS } from "@/lib/types";
import { Maximize2, Play, Radio, Search, X, ChevronRight, UserRound } from "lucide-react";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { VideoLightbox } from "@/components/ui/VideoLightbox";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";

/* ── types ── */
interface MapPost {
  id: string;
  category: string;
  latitude: number;
  longitude: number;
  address?: string | null;
  comment?: string | null;
  status?: string;
  created_at?: string;
}
interface MapSOS {
  id: string;
  latitude: number;
  longitude: number;
  avatar_url?: string;
  full_name?: string;
  tag?: string;
  message?: string;
  voice_note_url?: string;
  address?: string;
  created_at?: string;
  user_id?: string;
}
export interface MapHelper {
  id: string;
  name: string;
  avatar_url?: string | null;
  lat: number;
  lng: number;
  eta: number;
  sosId: string;
  milestone?: string | null;
}
interface MapBeacon {
  id: string;
  device_id: string;
  name: string;
  status: string;
  battery_pct: number | null;
  last_lat: number | null;
  last_lng: number | null;
  last_fix_at: string | null;
  last_seen_at: string | null;
  sos_active: boolean;
  wearer_name: string | null;
  wearer_color: string | null;
  share_with_contacts: boolean;
  owner_id: string;
  owner_name: string;
  owner_avatar: string | null;
  shared_with: { name: string; granted_at: string }[];
  hidden_from: string[];
}

/* A grid cell of people, for when the view holds too many to draw
   faces. Counted in Postgres, never shipped as rows. */
interface MapCluster {
  lat: number;
  lng: number;
  count: number;
}

/* A user's position, from whichever capture path knows best. See
   /api/admin/user-locations: the app writes presence while open on any
   platform, the native Android service keeps writing it backgrounded,
   and the Beacon reports its own GPS over GSM independently of the
   phone. `source` says which one this pin came from. */
interface MapUser {
  id: string;
  name: string;
  avatar: string | null;
  status: string | null;
  isAdmin: boolean;
  isGuardian: boolean;
  lat: number | null;
  lng: number | null;
  source: "presence" | "last_known" | "beacon";
  capturedAt: string | null;
  address: string | null;
  accuracyM: number | null;
  speedKmh: number | null;
  heading: number | null;
  stillSince: string | null;
  batteryPct: number | null;
  tracking: "background" | "foreground";
  trackingLastBeat: string | null;
  beacons: {
    id: string;
    name: string;
    lat: number | null;
    lng: number | null;
    lastFixAt: string | null;
    status: string;
    sosActive: boolean;
  }[];
}

/* ── severity weight per category color ── */
function getCategorySeverity(cid: string): number {
  const c = CATEGORIES.find((x) => x.id === cid);
  switch (c?.color) {
    case "danger":
      return 1.0;
    case "warning":
      return 0.7;
    case "awareness":
      return 0.4;
    default:
      return 0.25;
  }
}

/* ── time decay: recent = heavier ── */
function getTimeWeight(createdAt?: string): number {
  if (!createdAt) return 0.3;
  const ageHours =
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours < 6) return 1.0;
  if (ageHours < 24) return 0.85;
  if (ageHours < 72) return 0.6;
  if (ageHours < 168) return 0.4; // 7 days
  if (ageHours < 720) return 0.25; // 30 days
  return 0.15;
}

/* ── util ── */
function getCategoryColor(cid: string): string {
  const c = CATEGORIES.find((x) => x.id === cid);
  switch (c?.color) {
    case "danger":
      return "#ef4444";
    case "warning":
      return "#f97316";
    case "awareness":
      return "#eab308";
    default:
      return "#3b82f6";
  }
}

function getCategoryName(cid: string): string {
  return CATEGORIES.find((x) => x.id === cid)?.name || cid;
}

/* How much to trust a pin, and how to say so. Freshness is the honest
   signal here: a background-tracked Android from 2 minutes ago and an
   iPhone that had the app open 2 minutes ago are equally current, and a
   six-hour-old fix is stale no matter which path produced it. */
function fixAge(capturedAt: string | null): { ring: string; tone: string; label: string } {
  if (!capturedAt) return { ring: "#6b7280", tone: "#9ca3af", label: "no timestamp" };
  const mins = (Date.now() - new Date(capturedAt).getTime()) / 60000;
  if (mins < 10) return { ring: "#22c55e", tone: "#4ade80", label: "live" };
  if (mins < 120) return { ring: "#eab308", tone: "#facc15", label: "recent" };
  if (mins < 1440) return { ring: "#f97316", tone: "#fb923c", label: "today" };
  return { ring: "#6b7280", tone: "#9ca3af", label: "stale" };
}

/* Where this pin came from, in the words an admin needs. */
const SOURCE_LABEL: Record<MapUser["source"], string> = {
  presence: "Phone",
  last_known: "Last activity",
  beacon: "Beacon",
};

/* ══════════════════════════════════════════
   PAINT OBJECTS
   ══════════════════════════════════════════ */

const HEATMAP_PAINT: Record<string, any> = {
  "heatmap-weight": ["get", "weight"],
  "heatmap-intensity": [
    "interpolate",
    ["linear"],
    ["zoom"],
    0, 1,
    6, 1.5,
    10, 2.5,
    13, 3.5,
  ],
  "heatmap-radius": [
    "interpolate",
    ["linear"],
    ["zoom"],
    0, 15,
    6, 25,
    10, 35,
    13, 45,
    16, 60,
  ],
  "heatmap-opacity": [
    "interpolate",
    ["linear"],
    ["zoom"],
    0, 0.75,
    10, 0.7,
    14, 0.5,
    16, 0.25,
    18, 0,
  ],
  "heatmap-color": [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    "rgba(0,0,0,0)",
    // ↓ starts showing color much earlier
    0.01,
    "rgba(124,58,237,0.15)",
    0.05,
    "rgba(124,58,237,0.3)",
    0.15,
    "rgba(139,92,246,0.4)",
    0.3,
    "rgba(234,179,8,0.5)",
    0.5,
    "rgba(249,115,22,0.6)",
    0.7,
    "rgba(239,68,68,0.7)",
    0.85,
    "rgba(220,38,38,0.85)",
    1,
    "rgba(185,28,28,0.95)",
  ],
};

const CONNECTION_LINE_PAINT: Record<string, any> = {
  "line-color": "#22c55e",
  "line-width": 2.5,
  "line-dasharray": [4, 3],
  "line-opacity": 0.85,
};

/* Person to their Beacon. Solid violet, deliberately unlike the green
   dashed helper-to-SOS line: one says "someone is on the way", this one
   says "this hardware belongs to this account". */
const BEACON_LINK_PAINT: Record<string, any> = {
  "line-color": "#a855f7",
  "line-width": 2,
  "line-opacity": 0.75,
};

/* ── MAP STYLE — module-level constant ── */
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`;

/* ══════════════════════════════════════════
   COMPONENT
   ══════════════════════════════════════════ */
export default function AdminLiveMap({
  className = "",
  helpers = [],
  hideExpand = false,
}: {
  className?: string;
  helpers?: MapHelper[];
  hideExpand?: boolean;
}) {
  const router = useRouter();
  const mapRef = useRef<MapRef>(null);
  const [posts, setPosts] = useState<MapPost[]>([]);
  const [heatmapPosts, setHeatmapPosts] = useState<MapPost[]>([]);
  const [sosAlerts, setSOSAlerts] = useState<MapSOS[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showPins, setShowPins] = useState(true);
const [selectedPost, setSelectedPost] = useState<MapPost | null>(null);
  const [selectedPostMedia, setSelectedPostMedia] = useState<{ url: string; media_type: string; thumbnail_url?: string } | null>(null);
const [lightboxOpen, setLightboxOpen] = useState(false);
const [selectedSOS, setSelectedSOS] = useState<MapSOS | null>(null);
  const [videoLightboxOpen, setVideoLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [beacons, setBeacons] = useState<MapBeacon[]>([]);
  const [beaconPanel, setBeaconPanel] = useState(false);
  const [selectedBeacon, setSelectedBeacon] = useState<MapBeacon | null>(null);
  const [users, setUsers] = useState<MapUser[]>([]);
  const [clusters, setClusters] = useState<MapCluster[]>([]);
  const [peopleMode, setPeopleMode] = useState<"points" | "clusters">("points");
  const [peopleInView, setPeopleInView] = useState(0);
  const [showUsers, setShowUsers] = useState(true);
  const [selectedUser, setSelectedUser] = useState<MapUser | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<MapUser[]>([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /* Bumped on every map move so the viewport fetch re-runs. */
  const [viewportTick, setViewportTick] = useState(0);

  /* ── Beacon trackers: fetch + poll (devices move; 30s keeps pins honest) ── */
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/admin/beacons", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!stop && Array.isArray(data.beacons)) setBeacons(data.beacons);
      } catch {
        /* transient network errors: keep last known pins */
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  /* ── Where everyone is, for the current view only. Presence (app open,
     any platform), the native Android ambient service (app backgrounded
     or closed), the last deliberate location, or the Beacon's own fix;
     Postgres picks the freshest per person.

     Bounded by the viewport on purpose: what we transfer tracks what is
     on screen, not how many users exist, so panning somewhere new loads
     the people there and nothing else. Too many in view to draw faces
     and the server answers with counts per grid cell instead. ── */
  useEffect(() => {
    if (!showUsers) return;
    let stop = false;
    const load = async () => {
      try {
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token;
        if (!token) return;

        const b = mapRef.current?.getBounds();
        const zoom = mapRef.current?.getZoom() ?? 5;
        const qs = new URLSearchParams({ zoom: String(zoom) });
        if (b) {
          qs.set("west", String(b.getWest()));
          qs.set("south", String(b.getSouth()));
          qs.set("east", String(b.getEast()));
          qs.set("north", String(b.getNorth()));
        }

        const res = await fetch(`/api/admin/user-locations?${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (stop) return;
        setPeopleInView(Number(data.total) || 0);
        if (data.mode === "clusters") {
          setPeopleMode("clusters");
          setClusters(Array.isArray(data.cells) ? data.cells : []);
          setUsers([]);
        } else {
          setPeopleMode("points");
          setUsers(Array.isArray(data.users) ? data.users : []);
          setClusters([]);
        }
      } catch {
        /* transient network errors: keep the last known pins */
      }
    };
    // Debounced against panning: a drag fires a lot of move events and
    // none of the intermediate views are worth a query.
    const debounce = setTimeout(load, 350);
    const t = setInterval(load, 30_000);
    return () => { stop = true; clearTimeout(debounce); clearInterval(t); };
  }, [showUsers, viewportTick]);

  /* ── Search reaches the whole user base, not the current view. Someone
     looking for a name during an incident must find that person whether
     or not the map happens to be pointed at them. ── */
  useEffect(() => {
    const q = userSearch.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let stop = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data: auth } = await supabase.auth.getSession();
        const token = auth.session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/admin/user-locations?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!stop) setSearchResults(Array.isArray(data.users) ? data.users : []);
      } catch {
        /* leave the previous results up rather than blanking the list */
      } finally {
        if (!stop) setSearching(false);
      }
    }, 300);
    return () => { stop = true; clearTimeout(t); };
  }, [userSearch]);


  // Fetch media for selected post
  useEffect(() => {
    if (!selectedPost) { setSelectedPostMedia(null); return; }
    (async () => {
      const { data } = await supabase
        .from("post_media")
        .select("url, media_type, thumbnail_url")
        .eq("post_id", selectedPost.id)
        .limit(1)
        .maybeSingle();
      setSelectedPostMedia(data || null);
    })();
  }, [selectedPost?.id]);

  /* ── initial data ── */
  useEffect(() => {
    (async () => {
      const [postsRes, heatmapRes, sosRes] = await Promise.all([
        // Recent posts for pins (500)
        supabase
          .from("posts")
          .select(
            "id, category, latitude, longitude, address, comment, status, created_at"
          )
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .in("status", ["live", "resolved"])
          .order("created_at", { ascending: false })
          .limit(500),
        // ALL geolocated posts for heatmap (up to 5000)
        supabase
          .from("posts")
          .select("id, category, latitude, longitude, status, created_at")
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .order("created_at", { ascending: false })
          .limit(5000),
        supabase
          .from("sos_alerts")
          .select(
            "id, latitude, longitude, user_id, tag, message, voice_note_url, address, created_at, users:user_id(full_name, avatar_url)"
          )
          .eq("status", "active"),
      ]);

      if (postsRes.data)
        setPosts(
          postsRes.data.map((p: any) => ({
            id: p.id,
            category: p.category,
            latitude: p.latitude,
            longitude: p.longitude,
            address: p.address,
            comment: p.comment,
            status: p.status,
            created_at: p.created_at,
          }))
        );

      if (heatmapRes.data)
        setHeatmapPosts(
          heatmapRes.data.map((p: any) => ({
            id: p.id,
            category: p.category,
            latitude: p.latitude,
            longitude: p.longitude,
            status: p.status,
            created_at: p.created_at,
          }))
        );

      if (sosRes.data)
        setSOSAlerts(
          sosRes.data.map((s: any) => ({
            id: s.id,
            latitude: s.latitude,
            longitude: s.longitude,
            avatar_url: s.users?.avatar_url,
            full_name: s.users?.full_name,
            tag: s.tag,
            message: s.message,
            voice_note_url: s.voice_note_url,
            address: s.address,
            created_at: s.created_at,
            user_id: s.user_id,
          }))
        );
    })();
  }, []);

  /* ── real-time ── */
  useEffect(() => {
    const ch1 = supabase
      .channel("admin-lm-p")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const p = payload.new as any;
          if (p.latitude && p.longitude) {
            const newPost = {
              id: p.id,
              category: p.category,
              latitude: p.latitude,
              longitude: p.longitude,
              address: p.address,
              comment: p.comment,
              status: p.status,
              created_at: p.created_at,
            };
            setPosts((prev) => [newPost, ...prev].slice(0, 500));
            setHeatmapPosts((prev) => [newPost, ...prev].slice(0, 5000));
          }
        }
      )
      .subscribe();

    const ch2 = supabase
      .channel("admin-lm-s")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sos_alerts" },
        async (payload) => {
          if (payload.eventType === "INSERT") {
            const s = payload.new as any;
            const { data: u } = await supabase
              .from("users")
              .select("full_name, avatar_url")
              .eq("id", s.user_id)
              .single();
           setSOSAlerts((prev) => [
              {
                id: s.id,
                latitude: s.latitude,
                longitude: s.longitude,
                avatar_url: u?.avatar_url,
                full_name: u?.full_name,
                tag: s.tag,
                message: s.message,
                voice_note_url: s.voice_note_url,
                address: s.address,
                created_at: s.created_at,
                user_id: s.user_id,
              },
              ...prev,
            ]);
          } else if (payload.eventType === "UPDATE") {
            const s = payload.new as any;
            if (s.status !== "active")
              setSOSAlerts((prev) => prev.filter((a) => a.id !== s.id));
            else
              setSOSAlerts((prev) =>
                prev.map((a) =>
                  a.id === s.id
                    ? { ...a, latitude: s.latitude, longitude: s.longitude }
                    : a
                )
              );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, []);

  /* ── GeoJSON: weighted heatmap ── */
  const heatmapData = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: heatmapPosts.map((p) => {
        const severity = getCategorySeverity(p.category);
        const timeWeight = getTimeWeight(p.created_at);
        // Live posts get a boost
        const statusBoost = p.status === "live" ? 1.3 : 1.0;
        const weight = Math.min(severity * timeWeight * statusBoost, 1.0);

        return {
          type: "Feature" as const,
          properties: { weight } as Record<string, unknown>,
          geometry: {
            type: "Point" as const,
            coordinates: [p.longitude, p.latitude] as [number, number],
          },
        };
      }),
    }),
    [heatmapPosts]
  );

  /* ── GeoJSON: helper → SOS connection lines ── */
  const connectionLines = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: helpers
        .map((h) => {
          const sos = sosAlerts.find((s) => s.id === h.sosId);
          if (!sos) return null;
          return {
            type: "Feature" as const,
            properties: { eta: h.eta, name: h.name } as Record<
              string,
              unknown
            >,
            geometry: {
              type: "LineString" as const,
              coordinates: [
                [h.lng, h.lat] as [number, number],
                [sos.longitude, sos.latitude] as [number, number],
              ],
            },
          };
        })
        .filter((f): f is NonNullable<typeof f> => f !== null),
    }),
    [helpers, sosAlerts]
  );

  /* ── Person to Beacon links. One segment per device that has a fix.
     A user whose own pin CAME from a beacon sits on top of that device,
     so that segment would be zero-length: skip anything under ~5m
     rather than painting a dot. ── */
  const beaconLinks = useMemo(() => {
    const features = [];
    for (const u of users) {
      if (u.lat == null || u.lng == null) continue;
      for (const b of u.beacons) {
        if (b.lat == null || b.lng == null) continue;
        const dLat = Math.abs(b.lat - u.lat);
        const dLng = Math.abs(b.lng - u.lng);
        if (dLat < 0.00005 && dLng < 0.00005) continue;
        features.push({
          type: "Feature" as const,
          properties: { userId: u.id, beaconId: b.id } as Record<string, unknown>,
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [u.lng, u.lat] as [number, number],
              [b.lng, b.lat] as [number, number],
            ],
          },
        });
      }
    }
    return { type: "FeatureCollection" as const, features };
  }, [users]);

  /* ── midpoints for ETA labels ── */
  const etaLabels = useMemo(
    () =>
      helpers
        .map((h) => {
          const sos = sosAlerts.find((s) => s.id === h.sosId);
          if (!sos) return null;
          return {
            id: h.id,
            lat: (h.lat + sos.latitude) / 2,
            lng: (h.lng + sos.longitude) / 2,
            eta: h.eta,
            name: h.name,
            milestone: h.milestone,
          };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null),
    [helpers, sosAlerts]
  );

  /* ── People blobs: the server already counted per grid cell, so this
     is a plain GeoJSON source, not MapLibre's own clustering. Drawn on
     the GPU as one layer, so ten cells and two thousand cost the same. ── */
  const clusterGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: clusters.map((c) => ({
        type: "Feature" as const,
        properties: { count: c.count, label: c.count >= 1000 ? `${Math.round(c.count / 100) / 10}k` : String(c.count) },
        geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] as [number, number] },
      })),
    }),
    [clusters],
  );

  const flyTo = useCallback((lat: number, lng: number) => {
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: 15,
      duration: 1200,
    });
  }, []);

  /* ── Selecting a person: fly to them, open their card, drop the search
     overlay so the map is actually visible underneath. ── */
  const openUser = useCallback(
    (u: MapUser) => {
      // Search can return someone we cannot place. Open their card
      // anyway and say so there, rather than silently doing nothing.
      if (u.lat != null && u.lng != null) flyTo(u.lat, u.lng);
      setSelectedUser(u);
      setSelectedBeacon(null);
      setSearchOpen(false);
      setUserSearch("");
    },
    [flyTo],
  );

  /* A beacon answers for a person. Clicking one resolves the owner and
     shows their card, so device to human is a single tap. */
  const openOwnerOf = useCallback(
    (b: MapBeacon) => {
      const owner = users.find((u) => u.id === b.owner_id);
      if (owner) {
        openUser(owner);
        return;
      }
      // Owner has no known position anywhere: go straight to the profile
      // rather than pretending we can point at them on the map.
      router.push(`/admin/users/${b.owner_id}`);
    },
    [users, openUser, router],
  );

  /* ── heatmap stats ── */
  const heatmapStats = useMemo(() => {
    const now = Date.now();
    const last24h = heatmapPosts.filter(
      (p) =>
        p.created_at &&
        now - new Date(p.created_at).getTime() < 24 * 60 * 60 * 1000
    ).length;
    const last7d = heatmapPosts.filter(
      (p) =>
        p.created_at &&
        now - new Date(p.created_at).getTime() < 7 * 24 * 60 * 60 * 1000
    ).length;
    return { total: heatmapPosts.length, last24h, last7d };
  }, [heatmapPosts]);

return (
    <div
      className={`relative w-full h-full rounded-xl overflow-hidden border border-white/10 ${className}`}
    >
      {/* Popup style overrides for dark theme */}
      <style>{`
        .admin-post-popup .maplibregl-popup-content {
          background: rgba(20, 16, 36, 0.95) !important;
          backdrop-filter: blur(16px) !important;
          padding: 0 !important;
          border-radius: 16px !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          box-shadow: 0 20px 40px rgba(0,0,0,0.5) !important;
          overflow: hidden !important;
        }
        .admin-post-popup .maplibregl-popup-tip {
          border-top-color: rgba(20, 16, 36, 0.95) !important;
        }
        .admin-post-popup .maplibregl-popup-anchor-top .maplibregl-popup-tip {
          border-bottom-color: rgba(20, 16, 36, 0.95) !important;
        }
        .admin-post-popup .maplibregl-popup-close-button {
          color: rgba(255,255,255,0.5) !important;
          font-size: 18px !important;
          padding: 4px 8px !important;
          right: 4px !important;
          top: 4px !important;
        }
        .admin-post-popup .maplibregl-popup-close-button:hover {
          color: white !important;
          background: rgba(255,255,255,0.1) !important;
          border-radius: 8px !important;
        }
      `}</style>

      <MapGL
        ref={mapRef}
        initialViewState={{ longitude: 3.3792, latitude: 6.5244, zoom: 6 }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={MAP_STYLE}
        maxZoom={18}
        minZoom={3}
        // Collapse the required MapTiler/OSM attribution to the small "i".
        attributionControl={{ compact: true }}
        onLoad={() => {
          setMapLoaded(true);
          // First real bounds: the initial fetch asked for the world.
          setViewportTick((t) => t + 1);
        }}
        // Pan or zoom, reload the people in the new view. The fetch
        // itself is debounced, so a drag costs one query, not fifty.
        onMoveEnd={() => setViewportTick((t) => t + 1)}
        interactiveLayerIds={peopleMode === "clusters" ? ["people-clusters"] : []}
        // Tapping a blob dives into it, the way you would expect.
        onClick={(e) => {
          const f = e.features?.[0];
          if (!f || f.layer?.id !== "people-clusters") return;
          const [lng, lat] = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
          mapRef.current?.flyTo({
            center: [lng, lat],
            zoom: Math.min(18, (mapRef.current?.getZoom() ?? 6) + 2.5),
            duration: 900,
          });
        }}
      >
        {mapLoaded && (
          <>
            <NavigationControl position="top-right" showCompass={false} />
            {/* Fullscreen toggle */}
            {!hideExpand && (
            // Sits below the Hotspots/Pins toggle row on the analytics page,
            // so the icon doesn't overlap those buttons in the top-left.
            <div className="absolute top-14 left-2 z-10">
             <button
                onClick={() => window.dispatchEvent(new Event("peja-expand-admin-map"))}
                className="p-2 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-white hover:bg-black/80 transition-colors"
                title="Expand map"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
            )}
            {/* ── Heatmap layer ── */}
            {showHeatmap && heatmapPosts.length > 0 && (
              <Source id="heatmap-src" type="geojson" data={heatmapData}>
                <Layer
                  id="heatmap-lyr"
                  type="heatmap"
                  paint={HEATMAP_PAINT}
                />
              </Source>
            )}

            {/* ── Person to Beacon links (violet) ── */}
            {showUsers && beaconLinks.features.length > 0 && (
              <Source id="beacon-link-src" type="geojson" data={beaconLinks}>
                <Layer id="beacon-link-lyr" type="line" paint={BEACON_LINK_PAINT} />
              </Source>
            )}

            {/* ── Connection lines ── */}
            {connectionLines.features.length > 0 && (
              <Source id="conn-src" type="geojson" data={connectionLines}>
                <Layer
                  id="conn-lyr"
                  type="line"
                  paint={CONNECTION_LINE_PAINT}
                />
              </Source>
            )}

            {/* ── ETA labels at midpoints ── */}
            {etaLabels.map((l) => (
              <Marker
                key={`eta-${l.id}`}
                longitude={l.lng}
                latitude={l.lat}
                anchor="center"
              >
                <div className="glass-float px-2 py-1 rounded-full flex items-center gap-1.5 shadow-lg">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-green-300 whitespace-nowrap">
                    {l.milestone === "arrived"
                      ? "Arrived ✓"
                      : `${l.eta}m → ${l.name.split(" ")[0]}`}
                  </span>
                </div>
              </Marker>
            ))}

            {/* ── Post markers (teardrop pins) ── */}
            {showPins &&
              posts.map((p) => {
                const color = getCategoryColor(p.category);
                return (
                  <Marker
                    key={p.id}
                    longitude={p.longitude}
                    latitude={p.latitude}
                    anchor="bottom"
                    onClick={(e) => {
                      e.originalEvent.stopPropagation();
                      setSelectedPost(p);
                      flyTo(p.latitude, p.longitude);
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        background: color,
                        borderRadius: "50% 50% 50% 0",
                        transform: "rotate(-45deg)",
                        border: "2.5px solid white",
                        boxShadow: `0 3px 10px rgba(0,0,0,0.3), 0 0 6px ${color}40`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          background: "white",
                          borderRadius: "50%",
                          transform: "rotate(45deg)",
                        }}
                      />
                    </div>
                  </Marker>
                );
              })}

            {/* ── Post preview popup ── */}
            {selectedPost && (
              <Popup
                longitude={selectedPost.longitude}
                latitude={selectedPost.latitude}
                anchor="bottom"
                offset={[0, -30]}
                closeOnClick={true}
                closeButton={true}
                onClose={() => setSelectedPost(null)}
                className="admin-post-popup"
                maxWidth="280px"
              >
                <div style={{ minWidth: 220 }}>
                  {/* Category header */}
                  <div
                    style={{
                      padding: "10px 14px",
                      paddingRight: 32,
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: getCategoryColor(selectedPost.category),
                        boxShadow: `0 0 6px ${getCategoryColor(selectedPost.category)}60`,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        color: getCategoryColor(selectedPost.category),
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {getCategoryName(selectedPost.category)}
                    </span>
                    {selectedPost.status && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          padding: "2px 6px",
                          borderRadius: 6,
                          background:
                            selectedPost.status === "live"
                              ? "rgba(239,68,68,0.15)"
                              : "rgba(34,197,94,0.15)",
                          color:
                            selectedPost.status === "live"
                              ? "#f87171"
                              : "#4ade80",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {selectedPost.status}
                      </span>
                    )}
                  </div>
{/* Media preview */}
                  {selectedPostMedia && (
<div
                      style={{
                        position: "relative",
                        width: "100%",
                        aspectRatio: "16/9",
                        background: "#0c0818",
                        cursor: "pointer",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selectedPostMedia) {
                          setLightboxUrl(selectedPostMedia.url);
                          if (selectedPostMedia.media_type === "video") {
                            setVideoLightboxOpen(true);
                          } else {
                            setLightboxOpen(true);
                          }
                        }
                      }}
                    >
                      <img
                        src={selectedPostMedia.thumbnail_url || selectedPostMedia.url}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      {selectedPostMedia.media_type === "video" && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.3)",
                          }}
                        >
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: "50%",
                              background: "rgba(0,0,0,0.6)",
                              border: "2px solid white",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Play style={{ width: 20, height: 20, color: "white", marginLeft: 2 }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Content */}
                  <div style={{ padding: "10px 14px" }}>
                    {selectedPost.address && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "rgba(255,255,255,0.6)",
                          margin: 0,
                          marginBottom: 6,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span style={{ fontSize: 11, flexShrink: 0 }}>📍</span>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {selectedPost.address
                            .split(",")
                            .slice(0, 2)
                            .join(",")}
                        </span>
                      </p>
                    )}

                    {selectedPost.comment && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "rgba(255,255,255,0.8)",
                          margin: 0,
                          marginBottom: 6,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          lineHeight: 1.4,
                        }}
                      >
                        {selectedPost.comment}
                      </p>
                    )}

                    {selectedPost.created_at && (
                      <p
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.35)",
                          margin: 0,
                        }}
                      >
                        {formatDistanceToNow(
                          new Date(selectedPost.created_at),
                          { addSuffix: true }
                        )}
                      </p>
                    )}
                  </div>

                  {/* Footer */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/admin/posts?postId=${selectedPost.id}`);
                    }}
                    style={{
                      padding: "8px 14px",
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "rgba(139,92,246,0.9)",
                      }}
                    >
                      View Post →
                    </span>
                  </div>
                </div>
              </Popup>
            )}

            {/* ── SOS markers ── */}
            {sosAlerts.map((s) => (
              <Marker
                key={s.id}
                longitude={s.longitude}
                latitude={s.latitude}
                anchor="center"
              >
                <div
                  className="sos-marker-wrapper"
                  style={{
                    position: "relative",
                    width: 40,
                    height: 40,
                    cursor: "pointer",
                  }}
                  onClick={() => { flyTo(s.latitude, s.longitude); setSelectedSOS(s); }}
                >
                  <div
                    className="sos-glow-ring"
                    style={{ width: 40, height: 40 }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      overflow: "hidden",
                      border: "2px solid #dc2626",
                      background: "white",
                      zIndex: 2,
                    }}
                  >
                    <img
                      src={
                        s.avatar_url ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(
                          s.full_name || "S"
                        )}&background=dc2626&color=fff&size=48`
                      }
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  </div>
                </div>
              </Marker>
            ))}

            {/* ── Helper markers ── */}
            {helpers.map((h) => (
              <Marker
                key={`h-${h.id}-${h.sosId}`}
                longitude={h.lng}
                latitude={h.lat}
                anchor="center"
              >
                <div
                  style={{
                    position: "relative",
                    width: 34,
                    height: 34,
                    cursor: "pointer",
                  }}
                  onClick={() => flyTo(h.lat, h.lng)}
                >
                  <div
                    className="helper-glow-ring"
                    style={{ width: 34, height: 34 }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      overflow: "hidden",
                      border: "2px solid #22c55e",
                      background: "white",
                      zIndex: 2,
                    }}
                  >
                    <img
                      src={
                        h.avatar_url ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(
                          h.name.charAt(0)
                        )}&background=22c55e&color=fff&size=44`
                      }
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  </div>
                </div>
              </Marker>
            ))}

            {/* ── Too many people in view to draw faces: blobs. ── */}
            {showUsers && peopleMode === "clusters" && clusters.length > 0 && (
              <Source id="people-cluster-src" type="geojson" data={clusterGeoJSON}>
                <Layer
                  id="people-clusters"
                  type="circle"
                  paint={{
                    "circle-color": "#7c3aed",
                    "circle-opacity": 0.75,
                    "circle-radius": [
                      "step",
                      ["get", "count"],
                      14, 10, 18, 100, 24, 1000, 32, 10000, 42,
                    ],
                    "circle-stroke-width": 2,
                    "circle-stroke-color": "rgba(255,255,255,0.85)",
                  }}
                />
                <Layer
                  id="people-cluster-count"
                  type="symbol"
                  layout={{
                    "text-field": ["get", "label"],
                    "text-size": 12,
                    "text-font": ["Open Sans Bold"],
                    "text-allow-overlap": true,
                  }}
                  paint={{ "text-color": "#ffffff" }}
                />
              </Source>
            )}

            {/* ── User markers: avatar, ring colored by how fresh the fix
                is, small glyph for which capture path produced it. ── */}
            {showUsers &&
              peopleMode === "points" &&
              users.map((u) => {
                if (u.lat == null || u.lng == null) return null;
                const age = fixAge(u.capturedAt);
                const selected = selectedUser?.id === u.id;
                return (
                  <Marker
                    key={`user-${u.id}`}
                    longitude={u.lng}
                    latitude={u.lat}
                    anchor="center"
                  >
                    <div
                      style={{ position: "relative", width: 30, height: 30, cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openUser(u);
                      }}
                    >
                      <img
                        src={
                          u.avatar ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=7c3aed&color=fff&size=64`
                        }
                        alt=""
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: "50%",
                          objectFit: "cover",
                          border: `2px solid ${age.ring}`,
                          boxShadow: selected
                            ? "0 0 0 3px rgba(168,85,247,0.75)"
                            : "0 1px 4px rgba(0,0,0,0.5)",
                          background: "#1a1626",
                        }}
                      />
                      {/* Source glyph: a beacon-sourced pin is NOT the
                          phone, and the difference matters operationally. */}
                      {u.source === "beacon" && (
                        <span
                          style={{
                            position: "absolute",
                            bottom: -2,
                            right: -2,
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            background: "#a855f7",
                            border: "1.5px solid #0c0818",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Radio size={8} color="white" />
                        </span>
                      )}
                      {u.source === "presence" && u.tracking === "background" && (
                        <span
                          style={{
                            position: "absolute",
                            bottom: -1,
                            right: -1,
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: age.ring,
                            border: "1.5px solid #0c0818",
                          }}
                        />
                      )}
                    </div>
                  </Marker>
                );
              })}

            {/* ── Beacon tracker markers ── */}
            {beacons
              .filter((b) => b.last_lat != null && b.last_lng != null)
              .map((b) => {
                const online = b.status === "connected";
                const ring = b.sos_active ? "#dc2626" : online ? "#22c55e" : "#6b7280";
                return (
                  <Marker
                    key={`beacon-${b.id}`}
                    longitude={b.last_lng as number}
                    latitude={b.last_lat as number}
                    anchor="center"
                  >
                    <div
                      style={{ position: "relative", width: 34, height: 34, cursor: "pointer" }}
                      onClick={() => {
                        flyTo(b.last_lat as number, b.last_lng as number);
                        setSelectedBeacon(b);
                      }}
                    >
                      {b.sos_active && (
                        <div className="sos-glow-ring" style={{ width: 34, height: 34 }} />
                      )}
                      <div
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          border: `2px solid ${ring}`,
                          background: online ? b.wearer_color || "#7c3aed" : "#4b5563",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          zIndex: 2,
                          opacity: online ? 1 : 0.75,
                        }}
                      >
                        <Radio size={14} color="white" />
                      </div>
                      {(b.wearer_name || b.name) && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: "50%",
                            transform: "translateX(-50%)",
                            marginTop: 2,
                            padding: "1px 6px",
                            borderRadius: 999,
                            background: "rgba(0,0,0,0.7)",
                            color: "#fff",
                            fontSize: 9,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {b.wearer_name || b.name}
                        </div>
                      )}
                    </div>
                  </Marker>
                );
              })}

            {/* ── Beacon detail popup ── */}
            {selectedBeacon && selectedBeacon.last_lat != null && (
              <Popup
                longitude={selectedBeacon.last_lng as number}
                latitude={selectedBeacon.last_lat as number}
                anchor="bottom"
                offset={20}
                onClose={() => setSelectedBeacon(null)}
                closeButton={false}
                className="admin-map-popup"
              >
                <div style={{ minWidth: 200, padding: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <img
                      src={
                        selectedBeacon.owner_avatar ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedBeacon.owner_name)}&background=7c3aed&color=fff&size=48`
                      }
                      alt=""
                      style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
                    />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{selectedBeacon.owner_name}</div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        {selectedBeacon.name} · {selectedBeacon.device_id}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                    <div>
                      Status:{" "}
                      <b style={{ color: selectedBeacon.sos_active ? "#dc2626" : selectedBeacon.status === "connected" ? "#16a34a" : "#6b7280" }}>
                        {selectedBeacon.sos_active ? "SOS ACTIVE" : selectedBeacon.status}
                      </b>
                    </div>
                    <div>Battery: {selectedBeacon.battery_pct != null ? `${selectedBeacon.battery_pct}%` : "unknown"}</div>
                    <div>
                      Last fix:{" "}
                      {selectedBeacon.last_fix_at
                        ? formatDistanceToNow(new Date(selectedBeacon.last_fix_at), { addSuffix: true })
                        : "never"}
                    </div>
                    <div>
                      Last heard:{" "}
                      {selectedBeacon.last_seen_at
                        ? formatDistanceToNow(new Date(selectedBeacon.last_seen_at), { addSuffix: true })
                        : "never"}
                    </div>
                    {selectedBeacon.wearer_name && (
                      <div>
                        Worn by: <b>{selectedBeacon.wearer_name}</b>
                      </div>
                    )}
                    <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                      Shared with:{" "}
                      {selectedBeacon.shared_with.length > 0
                        ? selectedBeacon.shared_with.map((v) => v.name).join(", ")
                        : selectedBeacon.share_with_contacts
                          ? "owner's emergency contacts"
                          : "nobody"}
                    </div>
                    {selectedBeacon.hidden_from.length > 0 && (
                      <div style={{ opacity: 0.7 }}>
                        Hidden from: {selectedBeacon.hidden_from.join(", ")}
                      </div>
                    )}
                  </div>
                  {/* Device to human in one tap: show the owner on the map
                      if we know where they are, otherwise their profile. */}
                  <button
                    onClick={() => openOwnerOf(selectedBeacon)}
                    style={{
                      marginTop: 8,
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid rgba(168,85,247,0.4)",
                      background: "rgba(168,85,247,0.15)",
                      color: "#d8b4fe",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Show owner
                  </button>
                </div>
              </Popup>
            )}
          </>
        )}
        {/* ── User Detail Panel: who, where the fix came from, how old
            it is, their Beacons, and the way through to their page. ── */}
        {selectedUser && (() => {
          const age = fixAge(selectedUser.capturedAt);
          const withFix = selectedUser.beacons.filter((b) => b.lat != null && b.lng != null);
          return (
            <div
              className="absolute top-0 right-0 bottom-0 w-full max-w-sm z-20 overflow-y-auto"
              style={{
                background: "rgba(12, 8, 24, 0.95)",
                backdropFilter: "blur(20px)",
                borderLeft: "1px solid rgba(168, 85, 247, 0.25)",
                animation: "fadeIn 0.2s ease",
              }}
            >
              <div
                className="sticky top-0 z-10 flex items-center justify-between p-4"
                style={{ background: "rgba(12, 8, 24, 0.95)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: age.ring }} />
                  Person
                </h3>
                <button
                  onClick={() => setSelectedUser(null)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-dark-400"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                  <div
                    className="w-12 h-12 rounded-full overflow-hidden shrink-0"
                    style={{ border: `2px solid ${age.ring}` }}
                  >
                    <img
                      src={
                        selectedUser.avatar ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedUser.name)}&background=7c3aed&color=fff&size=96`
                      }
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-bold truncate">{selectedUser.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {selectedUser.isAdmin && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary-500/20 text-primary-300">
                          ADMIN
                        </span>
                      )}
                      {selectedUser.isGuardian && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">
                          GUARDIAN
                        </span>
                      )}
                      {selectedUser.status && selectedUser.status !== "active" && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 uppercase">
                          {selectedUser.status}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Where this pin came from, said plainly. */}
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                  <p className="text-[10px] text-dark-400 uppercase font-bold mb-1.5">Location</p>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(168,85,247,0.18)", color: "#d8b4fe" }}
                    >
                      {SOURCE_LABEL[selectedUser.source]}
                    </span>
                    <span className="text-[11px] font-semibold" style={{ color: age.tone }}>
                      {age.label}
                    </span>
                    <span className="text-[11px] text-dark-400">
                      {selectedUser.capturedAt
                        ? formatDistanceToNow(new Date(selectedUser.capturedAt), { addSuffix: true })
                        : "unknown time"}
                    </span>
                  </div>
                  {selectedUser.address && (
                    <p className="text-white text-sm mb-1">{selectedUser.address}</p>
                  )}
                  {selectedUser.lat != null && selectedUser.lng != null ? (
                    <p className="text-dark-500 text-[10px] font-mono">
                      {selectedUser.lat.toFixed(6)}, {selectedUser.lng.toFixed(6)}
                    </p>
                  ) : (
                    <p className="text-[11px] text-amber-300">
                      No location on record. Nothing has reported a position for this
                      person yet, so they cannot be placed on the map.
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-dark-400">
                    {selectedUser.accuracyM != null && <span>±{selectedUser.accuracyM}m</span>}
                    {selectedUser.speedKmh != null && <span>{selectedUser.speedKmh} km/h</span>}
                    {selectedUser.batteryPct != null && <span>{selectedUser.batteryPct}% battery</span>}
                  </div>
                </div>

                {/* Tracking mode: the difference between "we will keep
                    hearing from this phone" and "only while they look". */}
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                  <p className="text-[10px] text-dark-400 uppercase font-bold mb-1">Tracking</p>
                  {selectedUser.tracking === "background" ? (
                    <>
                      <p className="text-green-300 text-xs font-semibold">
                        Always on, app closed or open
                      </p>
                      <p className="text-dark-400 text-[11px] mt-0.5">
                        Background service is running on this phone. Last beat{" "}
                        {selectedUser.trackingLastBeat
                          ? formatDistanceToNow(new Date(selectedUser.trackingLastBeat), { addSuffix: true })
                          : "not recorded"}
                        .
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-dark-200 text-xs font-semibold">Only while the app is open</p>
                      <p className="text-dark-400 text-[11px] mt-0.5">
                        No background service on this phone, which is every iPhone and any
                        Android that declined. Their pin updates when they open Peja.
                      </p>
                    </>
                  )}
                </div>

                {/* Beacons on this account. */}
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                  <p className="text-[10px] text-dark-400 uppercase font-bold mb-2">
                    Beacons ({selectedUser.beacons.length})
                  </p>
                  {selectedUser.beacons.length === 0 ? (
                    <p className="text-dark-500 text-[11px]">No Beacon paired to this account.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {selectedUser.beacons.map((b) => (
                        <button
                          key={b.id}
                          disabled={b.lat == null}
                          onClick={() => {
                            if (b.lat != null && b.lng != null) flyTo(b.lat, b.lng);
                          }}
                          className="w-full flex items-center gap-2 text-left disabled:opacity-60"
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              background: b.sosActive
                                ? "#dc2626"
                                : b.status === "connected"
                                  ? "#22c55e"
                                  : "#6b7280",
                            }}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-white text-xs font-semibold truncate">
                              {b.name}
                              {b.sosActive && <span className="text-red-400"> · SOS</span>}
                            </span>
                            <span className="block text-dark-500 text-[10px]">
                              {b.lat == null
                                ? "no fix yet"
                                : `fix ${
                                    b.lastFixAt
                                      ? formatDistanceToNow(new Date(b.lastFixAt), { addSuffix: true })
                                      : "at unknown time"
                                  }`}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {withFix.length > 0 && (
                    <p className="text-[10px] mt-2" style={{ color: "#c084fc" }}>
                      Violet lines on the map join this person to{" "}
                      {withFix.length === 1 ? "their Beacon" : `their ${withFix.length} Beacons`}.
                    </p>
                  )}
                </div>

                {/* The menu through to their page. */}
                <div className="space-y-2">
                  <button
                    onClick={() => router.push(`/admin/users/${selectedUser.id}`)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-primary-500/15 border border-primary-500/30 text-primary-200 text-sm font-semibold active:scale-[0.97] transition-transform"
                  >
                    <span className="flex items-center gap-2">
                      <UserRound size={15} />
                      Open profile
                    </span>
                    <ChevronRight size={15} />
                  </button>
                  <button
                    onClick={() => router.push(`/admin/users?highlight=${selectedUser.id}`)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-dark-200 text-sm font-semibold active:scale-[0.97] transition-transform"
                  >
                    <span className="flex items-center gap-2">
                      <Search size={15} />
                      Find in user list
                    </span>
                    <ChevronRight size={15} />
                  </button>
                  {selectedUser.lat != null && selectedUser.lng != null && (
                    <button
                      onClick={() => flyTo(selectedUser.lat as number, selectedUser.lng as number)}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-dark-200 text-sm font-semibold active:scale-[0.97] transition-transform"
                    >
                      <span className="flex items-center gap-2">
                        <Radio size={15} />
                        Recenter on them
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── SOS Detail Panel ── */}
          {selectedSOS && (
            <div
              className="absolute top-0 right-0 bottom-0 w-full max-w-sm z-20 overflow-y-auto"
              style={{
                background: "rgba(12, 8, 24, 0.95)",
                backdropFilter: "blur(20px)",
                borderLeft: "1px solid rgba(239, 68, 68, 0.2)",
                animation: "fadeIn 0.2s ease",
              }}
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-4" style={{ background: "rgba(12, 8, 24, 0.95)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  SOS Alert
                </h3>
                <button onClick={() => setSelectedSOS(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-dark-400">✕</button>
              </div>

              <div className="p-4 space-y-4">
                {/* User */}
                <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-red-500 shrink-0">
                    <img
                      src={selectedSOS.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedSOS.full_name || "S")}&background=dc2626&color=fff`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <p className="font-semibold text-white">{selectedSOS.full_name || "Unknown"}</p>
                    {selectedSOS.created_at && (
                      <p className="text-xs text-dark-400">{formatDistanceToNow(new Date(selectedSOS.created_at), { addSuffix: true })}</p>
                    )}
                  </div>
                </div>

                {/* Tag/Situation */}
                {selectedSOS.tag && (() => {
                  const tagInfo = SOS_TAGS.find((t: any) => t.id === selectedSOS.tag);
                  return (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <p className="text-[10px] text-red-300 uppercase font-bold mb-1">Situation</p>
                      <p className="text-white font-semibold">{tagInfo?.label || selectedSOS.tag}</p>
                      {tagInfo?.suggestion && (
                        <p className="text-dark-400 text-xs mt-1">{tagInfo.suggestion}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Address */}
                {selectedSOS.address && (
                  <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                    <p className="text-[10px] text-dark-400 uppercase font-bold mb-1">Location</p>
                    <p className="text-white text-sm">{selectedSOS.address}</p>
                    <p className="text-dark-500 text-[10px] mt-1 font-mono">{selectedSOS.latitude.toFixed(6)}, {selectedSOS.longitude.toFixed(6)}</p>
                  </div>
                )}

                {/* Message */}
                {selectedSOS.message && (
                  <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                    <p className="text-[10px] text-red-300 uppercase font-bold mb-1">Message</p>
                    <p className="text-white text-sm">"{selectedSOS.message}"</p>
                  </div>
                )}

                {/* Voice Note */}
                {selectedSOS.voice_note_url && (
                  <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                    <p className="text-[10px] text-dark-400 uppercase font-bold mb-2">Voice Note</p>
                    <div className="[&>div]:max-w-none [&>div]:w-full">
                      <VoiceNotePlayer src={selectedSOS.voice_note_url} />
                    </div>
                  </div>
                )}

                {/* Helpers coming */}
                {helpers.filter(h => h.sosId === selectedSOS.id).length > 0 && (
                  <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
                    <p className="text-[10px] text-green-300 uppercase font-bold mb-2">Helpers Responding</p>
                    <div className="space-y-2">
                      {helpers.filter(h => h.sosId === selectedSOS.id).map(h => (
                        <div key={h.id} className="flex items-center gap-2 p-2 bg-green-500/10 rounded-lg">
                          <div className="w-8 h-8 rounded-full overflow-hidden border border-green-500 shrink-0">
                            <img
                              src={h.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(h.name)}&background=22c55e&color=fff`}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-medium text-white">{h.name}</p>
                            <p className="text-[10px] text-green-400">ETA: {Math.ceil(h.eta / 60)} min</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <button
                  onClick={() => router.push(`/admin/sos`)}
                  className="w-full py-3 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
                >
                  View in SOS Dashboard
                </button>
              </div>
            </div>
          )}
      </MapGL>

      {/* ── Controls ── */}
      {/* ── Beacon fleet panel: EVERY device, fix or no fix. The map can
          only show beacons with coordinates; this list shows the rest of
          the fleet too, with owner and sharing info at a glance. ── */}
      {beacons.length > 0 && (
        <button
          onClick={() => setBeaconPanel((v) => !v)}
          className="absolute top-32 right-3 z-10 glass-float rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-dark-100 flex items-center gap-1.5 active:scale-[0.97] transition-transform"
        >
          <Radio size={12} />
          Beacons ({beacons.length})
        </button>
      )}
      {beaconPanel && (
        <div
          className="absolute top-[10.5rem] right-3 z-10 w-72 max-h-[50%] overflow-y-auto rounded-xl"
          style={{
            background: "rgba(12, 8, 24, 0.95)",
            border: "1px solid rgba(139, 92, 246, 0.25)",
          }}
        >
          {beacons.map((b) => (
            <button
              key={`panel-${b.id}`}
              onClick={() => {
                if (b.last_lat != null && b.last_lng != null) {
                  flyTo(b.last_lat, b.last_lng);
                  setSelectedBeacon(b);
                  setBeaconPanel(false);
                }
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-white/5 last:border-b-0 active:bg-white/5"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  background: b.sos_active
                    ? "#dc2626"
                    : b.status === "connected"
                      ? b.wearer_color || "#22c55e"
                      : "#6b7280",
                }}
              />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-white truncate">
                  {b.wearer_name || b.name}
                  {b.sos_active && <span className="text-red-400"> · SOS</span>}
                </span>
                <span className="block text-[10px] text-dark-400 truncate">
                  {b.owner_name}
                  {" · "}
                  {b.shared_with.length > 0
                    ? `shared with ${b.shared_with.length}`
                    : b.share_with_contacts
                      ? "contacts see it"
                      : "not shared"}
                  {b.battery_pct != null ? ` · ${b.battery_pct}%` : ""}
                </span>
              </span>
              <span className="text-[9px] text-dark-500 shrink-0">
                {b.last_lat == null ? "no fix" : b.status}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="absolute top-3 left-3 flex gap-1.5">
        <button
          onClick={() => setShowHeatmap((v) => !v)}
          className={`glass-float px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            showHeatmap
              ? "text-red-300 border border-red-500/30 bg-red-500/10"
              : "text-dark-400 border border-transparent"
          }`}
        >
           Hotspots
        </button>
        <button
          onClick={() => setShowPins((v) => !v)}
          className={`glass-float px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            showPins
              ? "text-primary-300 border border-primary-500/30"
              : "text-dark-400 border border-transparent"
          }`}
        >
          📍 Pins
        </button>
        <button
          onClick={() => setShowUsers((v) => !v)}
          className={`glass-float px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
            showUsers
              ? "text-violet-300 border border-violet-500/30 bg-violet-500/10"
              : "text-dark-400 border border-transparent"
          }`}
        >
          <UserRound size={12} />
          People{peopleInView > 0 ? ` (${peopleInView.toLocaleString()})` : ""}
        </button>
        <button
          onClick={() => {
            setSearchOpen((v) => !v);
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }}
          className={`glass-float px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            searchOpen
              ? "text-violet-300 border border-violet-500/30 bg-violet-500/10"
              : "text-dark-400 border border-transparent"
          }`}
          aria-label="Search people on the map"
        >
          <Search size={12} />
        </button>
      </div>

      {/* Blob mode is not a failure state, but it does need explaining
          the first time someone sees it. */}
      {showUsers && peopleMode === "clusters" && (
        <div className="absolute bottom-3 left-3 z-10 glass-float rounded-lg px-2.5 py-1.5 text-[10px] text-dark-300 font-medium">
          <span style={{ color: "#c084fc" }} className="font-bold">
            {peopleInView.toLocaleString()}
          </span>{" "}
          people in view · zoom in for faces
        </div>
      )}

      {/* ── Map search: find a person, fly to them. Only people we have a
          position for are searchable here; the rest live in the user
          list, which this deliberately does not duplicate. ── */}
      {searchOpen && (
        <div className="absolute top-12 left-3 z-20 w-64">
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: "rgba(12, 8, 24, 0.97)",
              border: "1px solid rgba(168, 85, 247, 0.3)",
            }}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
              <Search size={13} className="text-dark-400 shrink-0" />
              <input
                ref={searchInputRef}
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search people"
                className="flex-1 min-w-0 bg-transparent text-white text-xs outline-none placeholder:text-dark-500"
              />
              <button
                onClick={() => {
                  setSearchOpen(false);
                  setUserSearch("");
                }}
                className="p-0.5 text-dark-400 hover:text-white shrink-0"
              >
                <X size={13} />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {userSearch.trim().length < 2 ? (
                <p className="px-3 py-3 text-[11px] text-dark-500">
                  {peopleInView.toLocaleString()}{" "}
                  {peopleInView === 1 ? "person" : "people"} in this view. Search
                  reaches everyone, not just who is on screen.
                </p>
              ) : searching ? (
                <p className="px-3 py-3 text-[11px] text-dark-500">Searching...</p>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-dark-500">
                  Nobody by that name.
                </p>
              ) : (
                searchResults.map((u) => {
                  const age = fixAge(u.capturedAt);
                  return (
                    <button
                      key={`search-${u.id}`}
                      onClick={() => openUser(u)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left border-b border-white/5 last:border-b-0 active:bg-white/5"
                    >
                      <img
                        src={
                          u.avatar ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=7c3aed&color=fff&size=48`
                        }
                        alt=""
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                        style={{ border: `1.5px solid ${age.ring}` }}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold text-white truncate">
                          {u.name}
                        </span>
                        <span className="block text-[10px] text-dark-400 truncate">
                          {u.lat == null ? (
                            <span className="text-amber-300">No location on record</span>
                          ) : (
                            <>
                              {SOURCE_LABEL[u.source]} ·{" "}
                              <span style={{ color: age.tone }}>{age.label}</span>
                            </>
                          )}
                          {u.beacons.length > 0 ? ` · ${u.beacons.length} beacon${u.beacons.length === 1 ? "" : "s"}` : ""}
                        </span>
                      </span>
                      <ChevronRight size={13} className="text-dark-500 shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Heatmap info badge ── */}
      {showHeatmap && (
        <div className="absolute top-3 right-14 glass-float rounded-lg px-2.5 py-1.5 text-[10px] text-dark-300 font-medium">
          <span className="text-red-400 font-bold">{heatmapStats.total.toLocaleString()}</span>{" "}
          data points •{" "}
          <span className="text-orange-400">{heatmapStats.last24h}</span> today •{" "}
          <span className="text-yellow-400">{heatmapStats.last7d}</span> this week
        </div>
      )}
      {/* Lightboxes */}
      <ImageLightbox
        isOpen={lightboxOpen}
        onClose={() => { setLightboxOpen(false); setLightboxUrl(null); }}
        imageUrl={lightboxUrl}
      />
      <VideoLightbox
        isOpen={videoLightboxOpen}
        onClose={() => { setVideoLightboxOpen(false); setLightboxUrl(null); }}
        videoUrl={lightboxUrl}
        postId={selectedPost?.id}
      />
</div>
  );
}