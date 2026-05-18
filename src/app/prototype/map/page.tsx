"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Shield,
  ArrowLeft,
  MapPin,
  Clock,
  AlertTriangle,
  Sun,
  Moon,
  Bell,
  User,
  Home,
  Map as MapIcon,
  PlusCircle,
  Search,
  Play,
  LocateFixed,
  LocateOff,
  Compass,
  Navigation,
  BarChart3,
  Layers,
  ChevronUp,
} from "lucide-react";
import {
  type Theme,
  type SamplePost,
  type Tokens,
  SAMPLE_POSTS,
  getTokens,
  urgencyToColor,
} from "../_shared";

const CATEGORIES = ["All", "Kidnapping", "Armed robbery", "Suspicious", "Accident"] as const;

export default function MapPrototypePage() {
  return (
    <Suspense fallback={null}>
      <MapPrototype />
    </Suspense>
  );
}

function MapPrototype() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialId = searchParams.get("id");

  const [theme, setTheme] = useState<Theme>("dark");
  const [hasLocation, setHasLocation] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [drawerExpanded, setDrawerExpanded] = useState(!!initialId);
  const [showLegend, setShowLegend] = useState(false);
  const [compassOn, setCompassOn] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [menuOpen, setMenuOpen] = useState(false);
  const t = getTokens(theme);

  const visible = SAMPLE_POSTS.filter((p) => category === "All" || p.category === category);
  const criticalCount = SAMPLE_POSTS.filter((p) => p.urgency === "critical" && p.isLive).length;

  const handlePinClick = (id: string) => {
    setSelectedId(id);
    setDrawerExpanded(true);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: t.bg,
        color: t.ink,
        WebkitFontSmoothing: "antialiased",
        transition: "background-color 0.4s ease",
      }}
    >
      <div
        style={{
          position: "relative",
          maxWidth: 480,
          height: "100%",
          margin: "0 auto",
          overflow: "hidden",
        }}
      >
        {/* MAP */}
        <MapCanvas
          theme={theme}
          t={t}
          posts={visible}
          selectedId={selectedId}
          onSelect={handlePinClick}
          hasLocation={hasLocation}
        />

        {/* HEADER */}
        <header
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "14px 12px 8px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            zIndex: 25,
          }}
        >
          <Pill theme={theme} t={t}>
            <button
              onClick={() => router.push("/prototype")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "0 14px",
                height: "100%",
                background: "transparent",
                border: "none",
                color: t.ink,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              <ArrowLeft size={16} />
              Map
            </button>
          </Pill>

          <div style={{ flex: 1 }} />

          <Pill theme={theme} t={t}>
            <div style={{ display: "flex", alignItems: "center", padding: "0 6px", gap: 2 }}>
              <IconBtn
                t={t}
                onClick={() => setHasLocation(!hasLocation)}
                active={hasLocation}
              >
                {hasLocation ? <LocateFixed size={18} /> : <LocateOff size={18} />}
              </IconBtn>
              <IconBtn t={t} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </IconBtn>
              <IconBtn t={t} badge={3}>
                <Bell size={18} />
              </IconBtn>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: t.primaryGlow,
                  display: "grid",
                  placeItems: "center",
                  margin: "0 2px",
                  border: `1.5px solid ${t.hairline}`,
                }}
              >
                <User size={14} color={t.body} />
              </div>
            </div>
          </Pill>
        </header>

        {/* SOS banner (centered, under header) */}
        {criticalCount > 0 && (
          <div
            style={{
              position: "absolute",
              top: 70,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 22,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                height: 40,
                padding: "0 14px 0 8px",
                background: t.dangerGlow,
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: `1px solid ${t.dangerStrong}`,
                borderRadius: 14,
                boxShadow: `0 4px 18px ${t.dangerGlow}`,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: t.dangerStrong,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <AlertTriangle size={15} color="#fff" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: theme === "dark" ? "#fff" : t.dangerStrong, whiteSpace: "nowrap" }}>
                {criticalCount} Active critical
              </span>
            </div>
          </div>
        )}

        {/* Category chips */}
        <div
          style={{
            position: "absolute",
            top: criticalCount > 0 ? 118 : 70,
            left: 12,
            right: 12,
            display: "flex",
            gap: 6,
            overflowX: "auto",
            scrollbarWidth: "none",
            zIndex: 21,
            transition: "top 0.2s ease",
          }}
        >
          {CATEGORIES.map((cat) => {
            const count =
              cat === "All"
                ? SAMPLE_POSTS.length
                : SAMPLE_POSTS.filter((p) => p.category === cat).length;
            const active = category === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "7px 13px",
                  borderRadius: 999,
                  background: active ? t.primaryStrong : t.pillBg,
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  border: `1px solid ${active ? t.primaryStrong : t.hairline}`,
                  color: active ? "#fff" : t.body,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow:
                    theme === "dark"
                      ? "0 2px 12px rgba(0,0,0,0.3)"
                      : "0 2px 12px rgba(60,40,20,0.08)",
                }}
              >
                {cat}
                <span
                  style={{
                    padding: "0 5px",
                    borderRadius: 999,
                    background: active ? "rgba(255,255,255,0.22)" : t.surface,
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Left controls (analytics) */}
        <div
          style={{
            position: "absolute",
            left: 14,
            bottom: drawerExpanded ? "60%" : 188,
            zIndex: 19,
            transition: "bottom 0.3s ease",
          }}
        >
          <CircleBtn t={t} theme={theme} title="Analytics">
            <BarChart3 size={18} color={t.primary} />
          </CircleBtn>
        </div>

        {/* Right controls (compass + recenter + legend) */}
        <div
          style={{
            position: "absolute",
            right: 14,
            bottom: drawerExpanded ? "calc(60% + 56px)" : 244,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 19,
            transition: "bottom 0.3s ease",
          }}
        >
          <CircleBtn t={t} theme={theme} onClick={() => setShowLegend(!showLegend)} active={showLegend} title="Legend">
            <Layers size={16} />
          </CircleBtn>
          <CircleBtn t={t} theme={theme} onClick={() => setCompassOn(!compassOn)} active={compassOn} title="Compass">
            <Compass size={16} />
          </CircleBtn>
          <CircleBtn t={t} theme={theme} title="Recenter on me">
            <Navigation size={16} color={t.primary} />
          </CircleBtn>
        </div>

        {/* Legend panel */}
        {showLegend && (
          <div
            style={{
              position: "absolute",
              right: 64,
              bottom: drawerExpanded ? "calc(60% + 56px)" : 244,
              padding: "10px 14px",
              background: t.surfaceCard,
              border: `1px solid ${t.hairline}`,
              borderRadius: 14,
              boxShadow:
                theme === "dark" ? "0 4px 16px rgba(0,0,0,0.4)" : "0 4px 16px rgba(60,40,20,0.1)",
              zIndex: 20,
              fontSize: 12,
              animation: "pejaSlideRight 0.18s ease",
            }}
          >
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 10,
                fontWeight: 700,
                color: t.muted,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Severity
            </p>
            <LegendItem color={t.dangerStrong} label="Critical" t={t} />
            <LegendItem color={t.warning} label="High" t={t} />
            <LegendItem color={t.primary} label="Medium" t={t} />
            <LegendItem color={t.muted} label="Resolved" t={t} dashed />
          </div>
        )}

        {/* Bottom peek drawer */}
        <Drawer
          theme={theme}
          t={t}
          expanded={drawerExpanded}
          onToggle={() => setDrawerExpanded(!drawerExpanded)}
          posts={visible}
          selectedId={selectedId}
          onSelectPost={setSelectedId}
          hasLocation={hasLocation}
        />
      </div>

      <BottomNav theme={theme} t={t} menuOpen={menuOpen} onPejaClick={() => setMenuOpen(!menuOpen)} />

      <style jsx global>{`
        @keyframes pejaPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes pejaPinPulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.4; }
          50% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }
        @keyframes pejaSlideRight {
          from { transform: translateX(8px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes pejaFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Map canvas
// ─────────────────────────────────────────────────────────────────────

function MapCanvas({
  theme,
  t,
  posts,
  selectedId,
  onSelect,
  hasLocation,
}: {
  theme: Theme;
  t: Tokens;
  posts: SamplePost[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasLocation: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: t.mapBg,
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(${t.mapGrid} 1px, transparent 1px), linear-gradient(90deg, ${t.mapGrid} 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
      />

      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        <path d="M 60 100 Q 70 92, 80 95 Q 92 98, 100 90 L 100 100 Z" fill={t.mapWater} />
        <path d="M 0 0 Q 8 6, 18 4 Q 25 2, 30 6 L 30 0 Z" fill={t.mapWater} />
        <rect x="28" y="40" width="14" height="8" fill={t.mapBlock} rx="0.5" />
        <rect x="44" y="42" width="10" height="12" fill={t.mapBlock} rx="0.5" />
        <rect x="56" y="38" width="10" height="10" fill={t.mapBlock} rx="0.5" />
        <rect x="14" y="55" width="11" height="8" fill={t.mapBlock} rx="0.5" />
        <rect x="35" y="62" width="14" height="10" fill={t.mapBlock} rx="0.5" />
        <rect x="62" y="55" width="9" height="14" fill={t.mapBlock} rx="0.5" />
        <rect x="78" y="35" width="12" height="9" fill={t.mapBlock} rx="0.5" />
        <rect x="14" y="22" width="9" height="11" fill={t.mapBlock} rx="0.5" />
        <rect x="74" y="20" width="11" height="8" fill={t.mapBlock} rx="0.5" />
        <path d="M 0 38 Q 30 34, 50 40 T 100 38" stroke={t.mapRoad} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M 0 70 Q 25 68, 50 72 T 100 68" stroke={t.mapRoad} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 26 0 Q 28 50, 26 100" stroke={t.mapRoad} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 70 0 Q 72 30, 68 60 Q 65 90, 72 100" stroke={t.mapRoad} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 44 0 L 50 50" stroke={t.mapRoad} strokeWidth="1" fill="none" strokeLinecap="round" />
        <path d="M 90 0 L 86 80" stroke={t.mapRoad} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M 0 10 L 40 22" stroke={t.mapRoad} strokeWidth="0.8" fill="none" strokeLinecap="round" />
        <circle cx="50" cy="40" r="2.5" stroke={t.mapRoad} strokeWidth="1" fill="none" />
        <circle cx="50" cy="40" r="0.8" fill={t.mapRoad} />
      </svg>

      {hasLocation && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: t.primary,
              opacity: 0.25,
              animation: "pejaPinPulse 2.5s ease-in-out infinite",
            }}
          />
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: t.primary,
              boxShadow: `0 0 0 4px ${theme === "dark" ? "#0a0814" : "#fff"}, 0 4px 12px rgba(0,0,0,0.3)`,
              position: "relative",
            }}
          />
        </div>
      )}

      {posts.map((post) => (
        <Pin
          key={post.id}
          post={post}
          t={t}
          theme={theme}
          selected={selectedId === post.id}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(post.id);
          }}
        />
      ))}
    </div>
  );
}

function Pin({
  post,
  t,
  theme,
  selected,
  onClick,
}: {
  post: SamplePost;
  t: Tokens;
  theme: Theme;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const color = urgencyToColor(post.urgency, t);
  const isCritical = post.urgency === "critical";
  const dim = !post.isLive;

  return (
    <button
      onClick={onClick}
      style={{
        position: "absolute",
        left: `${post.mapX}%`,
        top: `${post.mapY}%`,
        transform: `translate(-50%, -50%) scale(${selected ? 1.25 : 1})`,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
        zIndex: selected ? 10 : 6,
        transition: "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      {(selected || isCritical) && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: color,
            opacity: 0.3,
            animation: "pejaPinPulse 2s ease-in-out infinite",
          }}
        />
      )}

      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: dim ? `${color}55` : color,
          boxShadow: `0 0 0 ${selected ? 4 : 3}px ${
            theme === "dark" ? "#0a0814" : "#fff"
          }, 0 4px 10px rgba(0,0,0,0.35)`,
          position: "relative",
          border: dim ? `1.5px dashed ${color}` : "none",
          display: "grid",
          placeItems: "center",
        }}
      >
        {!dim && (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.95)",
              boxShadow: isCritical ? "0 0 4px rgba(255,255,255,0.8)" : "none",
            }}
          />
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Bottom peek drawer
// ─────────────────────────────────────────────────────────────────────

function Drawer({
  theme,
  t,
  expanded,
  onToggle,
  posts,
  selectedId,
  onSelectPost,
  hasLocation,
}: {
  theme: Theme;
  t: Tokens;
  expanded: boolean;
  onToggle: () => void;
  posts: SamplePost[];
  selectedId: string | null;
  onSelectPost: (id: string) => void;
  hasLocation: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 88,
        zIndex: 20,
        background: t.surfaceCard,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        border: `1px solid ${t.hairline}`,
        borderBottom: "none",
        height: expanded ? "60%" : 88,
        transition: "height 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
        boxShadow:
          theme === "dark"
            ? "0 -12px 36px rgba(0,0,0,0.5)"
            : "0 -10px 30px rgba(60,40,20,0.12)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Handle */}
      <button
        onClick={onToggle}
        style={{
          background: "transparent",
          border: "none",
          padding: "12px 16px 8px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 999,
            background: t.hairlineStrong,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: t.body,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {posts.length} {posts.length === 1 ? "incident" : "incidents"}
          </span>
          <ChevronUp
            size={14}
            color={t.muted}
            style={{
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.2s ease",
            }}
          />
        </div>
      </button>

      {/* List */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 12px 16px",
          opacity: expanded ? 1 : 0,
          transition: "opacity 0.2s ease",
          pointerEvents: expanded ? "auto" : "none",
        }}
      >
        {posts.map((post) => (
          <DrawerItem
            key={post.id}
            post={post}
            t={t}
            selected={selectedId === post.id}
            hasLocation={hasLocation}
            onClick={() => onSelectPost(post.id)}
          />
        ))}
      </div>
    </div>
  );
}

function DrawerItem({
  post,
  t,
  selected,
  hasLocation,
  onClick,
}: {
  post: SamplePost;
  t: Tokens;
  selected: boolean;
  hasLocation: boolean;
  onClick: () => void;
}) {
  const color = urgencyToColor(post.urgency, t);

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        gap: 10,
        padding: "10px",
        marginBottom: 6,
        width: "100%",
        textAlign: "left",
        background: selected ? t.primaryTint : t.surface,
        border: `1px solid ${selected ? t.primary : t.hairline}`,
        borderRadius: 14,
        cursor: "pointer",
        alignItems: "center",
        transition: "all 0.15s ease",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 10,
          overflow: "hidden",
          flexShrink: 0,
          background: t.mediaPlaceholder,
          position: "relative",
        }}
      >
        <img
          src={post.media[0].url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {post.media[0].type === "video" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "rgba(0,0,0,0.25)",
            }}
          >
            <Play size={14} color="#fff" fill="#fff" />
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              borderRadius: 999,
              background: t.primaryTint,
              color,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
            {post.category}
          </span>
          {hasLocation && (
            <span style={{ fontSize: 12, fontWeight: 700, color }}>{post.distance}</span>
          )}
          {post.isLive && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: t.live,
                letterSpacing: "0.04em",
              }}
            >
              LIVE
            </span>
          )}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: t.ink,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            letterSpacing: "-0.005em",
          }}
        >
          {post.comment}
        </p>
        <div
          style={{
            marginTop: 3,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            color: t.muted,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            <MapPin size={10} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{post.address}</span>
          </span>
          <span>·</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
            <Clock size={10} />
            {post.timeAgo}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Small components
// ─────────────────────────────────────────────────────────────────────

function Pill({
  children,
  t,
  theme,
}: {
  children: React.ReactNode;
  t: Tokens;
  theme: Theme;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: 44,
        background: t.pillBg,
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: `1px solid ${t.hairline}`,
        borderRadius: 16,
        boxShadow:
          theme === "dark"
            ? "0 2px 20px rgba(0,0,0,0.25), inset 0 0.5px 0 rgba(255,255,255,0.06)"
            : "0 2px 16px rgba(0,0,0,0.08), inset 0 0.5px 0 rgba(255,255,255,0.6)",
      }}
    >
      {children}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  badge,
  active,
  title,
  t,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  badge?: number;
  active?: boolean;
  title?: string;
  t: Tokens;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        position: "relative",
        width: 34,
        height: 34,
        borderRadius: 10,
        background: active ? t.primaryTint : "transparent",
        border: "none",
        color: active ? t.primary : t.body,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        transition: "all 0.15s ease",
      }}
    >
      {children}
      {badge != null && badge > 0 && (
        <span
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            minWidth: 14,
            height: 14,
            padding: "0 3px",
            borderRadius: 7,
            background: t.live,
            color: "#fff",
            fontSize: 9,
            fontWeight: 700,
            display: "grid",
            placeItems: "center",
            boxShadow: `0 0 6px ${t.dangerGlow}`,
          }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

function CircleBtn({
  children,
  onClick,
  active,
  large,
  title,
  t,
  theme,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  large?: boolean;
  title?: string;
  t: Tokens;
  theme: Theme;
}) {
  const size = large ? 44 : 40;
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: size,
        height: size,
        borderRadius: 14,
        background: active ? t.primaryTint : t.pillBg,
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: `1px solid ${active ? t.primary : t.hairline}`,
        color: active ? t.primary : t.body,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        boxShadow:
          theme === "dark"
            ? "0 2px 16px rgba(0,0,0,0.4)"
            : "0 4px 14px rgba(60,40,20,0.12)",
      }}
    >
      {children}
    </button>
  );
}

function LegendItem({
  color,
  label,
  dashed,
  t,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  t: Tokens;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: dashed ? "transparent" : color,
          border: dashed ? `1.5px dashed ${color}` : "none",
        }}
      />
      <span style={{ fontSize: 12, color: t.body, fontWeight: 500 }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Bottom nav
// ─────────────────────────────────────────────────────────────────────

function BottomNav({
  theme,
  t,
  menuOpen,
  onPejaClick,
}: {
  theme: Theme;
  t: Tokens;
  menuOpen: boolean;
  onPejaClick: () => void;
}) {
  const items = [
    { icon: Home, label: "Home", href: "/prototype" },
    { icon: MapIcon, label: "Map", active: true },
    { icon: PlusCircle, label: "Report" },
    { icon: Search, label: "Search" },
  ];

  return (
    <>
      {menuOpen && (
        <div
          onClick={onPejaClick}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            zIndex: 49,
            animation: "pejaFade 0.18s ease",
          }}
        />
      )}

      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "0 16px 16px",
          zIndex: 50,
        }}
      >
        <div style={{ position: "relative", maxWidth: 480 - 32, margin: "0 auto" }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              height: 60,
              background: t.pillBg,
              backdropFilter: "blur(40px) saturate(180%)",
              WebkitBackdropFilter: "blur(40px) saturate(180%)",
              border: `1px solid ${t.hairline}`,
              borderRadius: 22,
              boxShadow:
                theme === "dark" ? "0 2px 20px rgba(0,0,0,0.4)" : "0 4px 24px rgba(0,0,0,0.08)",
            }}
          >
            <NavItem t={t} item={items[0]} />
            <NavItem t={t} item={items[1]} />
            <div style={{ width: 68, flexShrink: 0 }} />
            <NavItem t={t} item={items[2]} />
            <NavItem t={t} item={items[3]} />
          </div>

          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: 18,
              transform: "translateX(-50%)",
              zIndex: 60,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: "100%",
                transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                transform: menuOpen
                  ? "translate(calc(-50% - 36px), -16px) scale(1)"
                  : "translate(-50%, 20px) scale(0)",
                opacity: menuOpen ? 1 : 0,
                pointerEvents: menuOpen ? "auto" : "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <button
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  background: `linear-gradient(135deg, ${t.success}, #047857)`,
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  boxShadow: `0 8px 24px rgba(5, 150, 105, 0.5)`,
                }}
              >
                <Shield size={22} strokeWidth={2.4} />
              </button>
              <span style={{ fontSize: 9, fontWeight: 700, color: t.success, letterSpacing: "0.1em" }}>
                SML
              </span>
            </div>

            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: "100%",
                transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.04s",
                transform: menuOpen
                  ? "translate(calc(-50% + 36px), -16px) scale(1)"
                  : "translate(-50%, 20px) scale(0)",
                opacity: menuOpen ? 1 : 0,
                pointerEvents: menuOpen ? "auto" : "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <button
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  background: `radial-gradient(circle at 30% 30%, ${t.danger}, ${t.dangerStrong})`,
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  boxShadow: `0 8px 24px ${t.dangerGlow}`,
                  fontWeight: 800,
                  fontSize: 14,
                  letterSpacing: "0.06em",
                }}
              >
                SOS
              </button>
              <span style={{ fontSize: 9, fontWeight: 700, color: t.danger, letterSpacing: "0.1em" }}>
                SOS
              </span>
            </div>

            <button
              onClick={onPejaClick}
              style={{
                position: "relative",
                width: 58,
                height: 58,
                borderRadius: "50%",
                background: menuOpen
                  ? t.surfaceSolid
                  : `linear-gradient(135deg, ${t.primaryGlow} 0%, rgba(124, 58, 237, 0.55) 100%)`,
                backdropFilter: "blur(40px)",
                WebkitBackdropFilter: "blur(40px)",
                border: `2px solid ${menuOpen ? t.primary : t.hairlineStrong}`,
                boxShadow: menuOpen
                  ? `0 0 30px ${t.primaryGlow}, 0 4px 20px rgba(0,0,0,0.3)`
                  : `0 0 15px ${t.primaryGlow}, 0 4px 16px rgba(0,0,0,0.25)`,
                cursor: "pointer",
                transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                transform: menuOpen ? "scale(0.88) rotate(45deg)" : "scale(1) rotate(0deg)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 13,
                  color: t.primary,
                  letterSpacing: "-0.02em",
                  transform: menuOpen ? "rotate(-45deg)" : "none",
                  transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              >
                P
              </div>
            </button>
          </div>
        </div>
      </nav>
    </>
  );
}

function NavItem({
  item,
  t,
}: {
  item: { icon: any; label: string; active?: boolean; href?: string };
  t: Tokens;
}) {
  const Icon = item.icon;
  const inner = (
    <div
      style={{
        flex: 1,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        padding: "8px 0",
        color: item.active ? t.primary : t.muted,
      }}
    >
      <Icon size={22} strokeWidth={item.active ? 2.6 : 2.2} />
      <span style={{ fontSize: 10, fontWeight: 600 }}>{item.label}</span>
    </div>
  );

  if (item.href) {
    return (
      <Link href={item.href} style={{ flex: 1, textDecoration: "none" }}>
        {inner}
      </Link>
    );
  }
  return <div style={{ flex: 1 }}>{inner}</div>;
}
