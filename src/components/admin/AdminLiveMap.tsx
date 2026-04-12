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
import { Maximize2, Play } from "lucide-react";
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

  const flyTo = useCallback((lat: number, lng: number) => {
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: 15,
      duration: 1200,
    });
  }, []);

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
        onLoad={() => setMapLoaded(true)}
      >
        {mapLoaded && (
          <>
            <NavigationControl position="top-right" showCompass={false} />
            {/* Fullscreen toggle */}
            {!hideExpand && (
            <div className="absolute top-2 left-2 z-10">
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
          </>
        )}
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
      </div>

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