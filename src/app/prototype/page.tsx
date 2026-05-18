"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Shield,
  MapPin,
  Clock,
  CheckCircle,
  MessageCircle,
  Eye,
  Share2,
  TrendingUp,
  Sun,
  Moon,
  Bell,
  User,
  Home,
  Map as MapIcon,
  PlusCircle,
  Search,
  Play,
  LayoutGrid,
  List,
  LocateFixed,
  LocateOff,
} from "lucide-react";
import {
  type Theme,
  type Urgency,
  type SamplePost,
  type Tokens,
  SAMPLE_POSTS,
  getTokens,
  urgencyToColor,
  formatCount,
} from "./_shared";

type Tab = "nearby" | "trending";
type ViewMode = "rich" | "compact";

export default function PrototypePage() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [tab, setTab] = useState<Tab>("nearby");
  const [viewMode, setViewMode] = useState<ViewMode>("rich");
  const [hasLocation, setHasLocation] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const t = getTokens(theme);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: t.bg,
        color: t.ink,
        overflowY: "auto",
        WebkitFontSmoothing: "antialiased",
        transition: "background-color 0.4s ease",
      }}
    >
      <div style={{ position: "relative", maxWidth: 480, margin: "0 auto", paddingBottom: 120 }}>
        {/* Header */}
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 30,
            padding: "14px 12px 8px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Pill theme={theme} t={t}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px" }}>
              <span style={{ color: t.primary, fontWeight: 900, fontSize: 17, letterSpacing: "-0.01em" }}>
                PEJA
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: t.muted,
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: `1px solid ${t.hairline}`,
                }}
              >
                PROTOTYPE
              </span>
            </div>
          </Pill>

          <div style={{ flex: 1 }} />

          <Pill theme={theme} t={t}>
            <div style={{ display: "flex", alignItems: "center", padding: "0 6px", gap: 2 }}>
              <IconBtn
                t={t}
                onClick={() => setHasLocation(!hasLocation)}
                active={hasLocation}
                title={hasLocation ? "Location on" : "Location off"}
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

        {/* Tabs + view toggle */}
        <div
          style={{
            padding: "12px 16px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <TabPill active={tab === "nearby"} onClick={() => setTab("nearby")} t={t}>
            <MapPin size={14} />
            Nearby
          </TabPill>
          <TabPill active={tab === "trending"} onClick={() => setTab("trending")} t={t}>
            <TrendingUp size={14} />
            Trending
          </TabPill>

          <div style={{ flex: 1 }} />

          <ViewToggle viewMode={viewMode} onChange={setViewMode} t={t} />
        </div>

        {/* Feed */}
        <main style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          {SAMPLE_POSTS.map((post) =>
            viewMode === "rich" ? (
              <RichPostCard key={post.id} post={post} theme={theme} t={t} hasLocation={hasLocation} />
            ) : (
              <CompactPostCard key={post.id} post={post} t={t} hasLocation={hasLocation} theme={theme} />
            )
          )}
        </main>
      </div>

      <BottomNav theme={theme} t={t} menuOpen={menuOpen} onPejaClick={() => setMenuOpen(!menuOpen)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Header pills & buttons
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
            : "0 2px 16px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.6)",
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

// ─────────────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────────────

function TabPill({
  children,
  active,
  onClick,
  t,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  t: Tokens;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "9px 16px",
        borderRadius: 12,
        background: active ? t.primaryStrong : t.surface,
        border: `1px solid ${active ? t.primaryStrong : t.hairline}`,
        color: active ? "#fff" : t.body,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.2s ease",
        boxShadow: active ? `0 4px 20px ${t.primaryGlow}` : "none",
      }}
    >
      {children}
    </button>
  );
}

function ViewToggle({
  viewMode,
  onChange,
  t,
}: {
  viewMode: ViewMode;
  onChange: (m: ViewMode) => void;
  t: Tokens;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: t.surface,
        border: `1px solid ${t.hairline}`,
        borderRadius: 12,
        padding: 3,
        gap: 2,
      }}
    >
      <button
        onClick={() => onChange("rich")}
        title="Rich view"
        style={{
          width: 30,
          height: 28,
          borderRadius: 9,
          border: "none",
          background: viewMode === "rich" ? t.primaryStrong : "transparent",
          color: viewMode === "rich" ? "#fff" : t.muted,
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
        }}
      >
        <LayoutGrid size={14} />
      </button>
      <button
        onClick={() => onChange("compact")}
        title="Compact list"
        style={{
          width: 30,
          height: 28,
          borderRadius: 9,
          border: "none",
          background: viewMode === "compact" ? t.primaryStrong : "transparent",
          color: viewMode === "compact" ? "#fff" : t.muted,
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
        }}
      >
        <List size={14} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Distance chip (only shown when location is allowed)
// ─────────────────────────────────────────────────────────────────────

function DistanceChip({
  distance,
  urgency,
  t,
  size = "md",
  postId,
}: {
  distance: string;
  urgency: Urgency;
  t: Tokens;
  size?: "sm" | "md";
  postId: string;
}) {
  const color = urgencyToColor(urgency, t);
  return (
    <Link
      href={`/prototype/map?id=${postId}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: size === "sm" ? "2px 7px" : "3px 9px",
        borderRadius: 999,
        background: t.primaryTint,
        border: `1px solid ${color}33`,
        color,
        fontSize: size === "sm" ? 11 : 12,
        fontWeight: 700,
        letterSpacing: "-0.01em",
        flexShrink: 0,
        textDecoration: "none",
        cursor: "pointer",
      }}
    >
      <LocateFixed size={size === "sm" ? 10 : 11} />
      {distance}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Confirm button with confetti
// ─────────────────────────────────────────────────────────────────────

function ConfirmButton({
  confirmed,
  onClick,
  t,
}: {
  confirmed: boolean;
  onClick: () => void;
  t: Tokens;
}) {
  const [burstKey, setBurstKey] = useState(0);

  const handleClick = () => {
    if (!confirmed) setBurstKey((k) => k + 1);
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      style={{
        position: "relative",
        flex: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "9px 12px",
        borderRadius: 12,
        background: confirmed ? t.primaryStrong : t.surface,
        color: confirmed ? "#fff" : t.body,
        border: `1px solid ${confirmed ? t.primaryStrong : t.hairline}`,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.15s ease",
        overflow: "visible",
      }}
    >
      <CheckCircle size={15} strokeWidth={2.2} />
      {confirmed ? "Confirmed" : "Confirm"}
      {burstKey > 0 && <Confetti key={burstKey} />}
    </button>
  );
}

function Confetti() {
  const colors = ["#a78bfa", "#fbbf24", "#34d399", "#f87171", "#60a5fa", "#f472b6"];
  const particles = Array.from({ length: 14 }).map((_, i) => {
    const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
    const distance = 22 + Math.random() * 16;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      color: colors[i % colors.length],
      size: 4 + Math.random() * 3,
      delay: Math.random() * 0.05,
    };
  });

  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        width: 0,
        height: 0,
        pointerEvents: "none",
      }}
    >
      {particles.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            width: p.size,
            height: p.size,
            borderRadius: i % 3 === 0 ? "20%" : "50%",
            background: p.color,
            top: 0,
            left: 0,
            transform: "translate(-50%, -50%)",
            animation: `pejaConfetti 0.7s ease-out ${p.delay}s forwards`,
            // @ts-expect-error custom CSS vars
            "--dx": `${p.dx}px`,
            "--dy": `${p.dy}px`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes pejaConfetti {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.4);
            opacity: 0;
          }
        }
      `}</style>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Rich card
// ─────────────────────────────────────────────────────────────────────

function RichPostCard({
  post,
  theme,
  t,
  hasLocation,
}: {
  post: SamplePost;
  theme: Theme;
  t: Tokens;
  hasLocation: boolean;
}) {
  const [mediaIdx, setMediaIdx] = useState(0);
  const [confirmed, setConfirmed] = useState(post.confirmed || false);
  const urgencyColor = urgencyToColor(post.urgency, t);
  const currentMedia = post.media[mediaIdx];

  return (
    <article
      style={{
        background: t.surfaceCard,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: `1px solid ${t.hairline}`,
        borderRadius: 22,
        overflow: "hidden",
        boxShadow:
          theme === "dark" ? "0 8px 28px rgba(0,0,0,0.3)" : "0 6px 24px rgba(60, 40, 20, 0.09)",
      }}
    >
      {/* Card header */}
      <div style={{ padding: "12px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        {post.isLive ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: t.live,
                boxShadow: `0 0 6px ${t.live}`,
                animation: "pejaPulse 1.4s ease-in-out infinite",
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 700, color: t.live, letterSpacing: "0.04em" }}>
              LIVE
            </span>
          </span>
        ) : (
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.muted }} />
        )}

        {hasLocation && <DistanceChip distance={post.distance} urgency={post.urgency} t={t} postId={post.id} />}

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            color: t.body,
            minWidth: 0,
            flex: 1,
            overflow: "hidden",
          }}
        >
          <MapPin size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {post.address}
          </span>
        </span>

        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, color: t.muted, flexShrink: 0 }}>
          <Clock size={11} />
          {post.timeAgo}
        </span>
      </div>

      {/* Media */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          background: t.mediaPlaceholder,
          overflow: "hidden",
        }}
      >
        <img
          src={currentMedia.url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          loading="lazy"
        />

        {currentMedia.type === "video" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "rgba(0,0,0,0.15)",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.6)",
                display: "grid",
                placeItems: "center",
                backdropFilter: "blur(8px)",
              }}
            >
              <Play size={22} color="#fff" fill="#fff" style={{ marginLeft: 3 }} />
            </div>
          </div>
        )}

        {/* Category chip */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: urgencyColor,
              boxShadow: post.urgency === "critical" ? `0 0 6px ${urgencyColor}` : "none",
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", letterSpacing: "0.02em" }}>
            {post.category}
          </span>
        </div>

        {/* Pagination dots */}
        {post.media.length > 1 && (
          <div
            style={{
              position: "absolute",
              bottom: 10,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              gap: 4,
            }}
          >
            {post.media.map((_, i) => (
              <button
                key={i}
                onClick={() => setMediaIdx(i)}
                style={{
                  width: i === mediaIdx ? 16 : 6,
                  height: 6,
                  borderRadius: 999,
                  background: i === mediaIdx ? "#fff" : "rgba(255,255,255,0.5)",
                  border: "none",
                  cursor: "pointer",
                  transition: "width 0.2s ease",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "14px 16px 8px" }}>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.55,
            color: t.ink,
            letterSpacing: "-0.005em",
          }}
        >
          {post.comment}
        </p>

        {post.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {post.tags.map((tag) => (
              <span key={tag} style={{ fontSize: 12, color: t.primary, fontWeight: 500 }}>
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div
        style={{
          padding: "8px 16px 10px",
          display: "flex",
          alignItems: "center",
          gap: 18,
          fontSize: 12,
          color: t.muted,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <CheckCircle size={14} strokeWidth={2} color={confirmed ? t.primary : t.muted} />
          {formatCount(post.confirmations)} confirms
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <MessageCircle size={14} />
          {formatCount(post.comments)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
          <Eye size={14} />
          {formatCount(post.views)} views
        </span>
      </div>

      {/* Actions */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "10px 16px 16px",
          borderTop: `1px solid ${t.hairline}`,
        }}
      >
        <ConfirmButton confirmed={confirmed} onClick={() => setConfirmed(!confirmed)} t={t} />
        <SecondaryBtn t={t} icon={<MessageCircle size={15} strokeWidth={2.2} />}>
          Comment
        </SecondaryBtn>
        <SecondaryBtn t={t} icon={<Share2 size={15} strokeWidth={2.2} />} compact />
      </div>
    </article>
  );
}

function SecondaryBtn({
  children,
  icon,
  compact,
  t,
}: {
  children?: React.ReactNode;
  icon: React.ReactNode;
  compact?: boolean;
  t: Tokens;
}) {
  return (
    <button
      style={{
        flex: compact ? "0 0 auto" : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: compact ? "9px 11px" : "9px 12px",
        borderRadius: 12,
        background: t.surface,
        color: t.body,
        border: `1px solid ${t.hairline}`,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Compact card
// ─────────────────────────────────────────────────────────────────────

function CompactPostCard({
  post,
  t,
  hasLocation,
  theme,
}: {
  post: SamplePost;
  t: Tokens;
  hasLocation: boolean;
  theme: Theme;
}) {
  const [confirmed, setConfirmed] = useState(post.confirmed || false);
  const [burstKey, setBurstKey] = useState(0);
  const urgencyColor = urgencyToColor(post.urgency, t);

  return (
    <article
      style={{
        background: t.surfaceCard,
        border: `1px solid ${t.hairline}`,
        borderRadius: 16,
        padding: "12px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow:
          theme === "dark" ? "0 4px 14px rgba(0,0,0,0.2)" : "0 4px 14px rgba(60, 40, 20, 0.06)",
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          background: t.mediaPlaceholder,
          overflow: "hidden",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <img
          src={post.media[0].url}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          loading="lazy"
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

      {/* Body */}
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
              color: urgencyColor,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: urgencyColor,
              }}
            />
            {post.category}
          </span>
          {hasLocation && (
            <Link
              href={`/prototype/map?id=${post.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: urgencyColor,
                textDecoration: "none",
              }}
            >
              {post.distance}
            </Link>
          )}
          {post.isLive && (
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: t.live,
                animation: "pejaPulse 1.4s ease-in-out infinite",
              }}
            />
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
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 11,
            color: t.muted,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            {post.address}
          </span>
          <span>·</span>
          <span style={{ flexShrink: 0 }}>{post.timeAgo}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <CheckCircle size={11} />
            {formatCount(post.confirmations)}
          </span>
        </div>
      </div>

      <button
        onClick={() => {
          if (!confirmed) setBurstKey((k) => k + 1);
          setConfirmed(!confirmed);
        }}
        style={{
          position: "relative",
          width: 36,
          height: 36,
          borderRadius: 12,
          border: `1px solid ${confirmed ? t.primary : t.hairline}`,
          background: confirmed ? t.primaryStrong : "transparent",
          color: confirmed ? "#fff" : t.muted,
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <CheckCircle size={16} strokeWidth={2.2} />
        {burstKey > 0 && <Confetti key={burstKey} />}
      </button>
    </article>
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
    { icon: Home, label: "Home", active: true },
    { icon: MapIcon, label: "Map", href: "/prototype/map" },
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
            {/* SML */}
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

            {/* SOS */}
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

            {/* Peja center */}
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

      <style jsx>{`
        @keyframes pejaPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes pejaFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
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
