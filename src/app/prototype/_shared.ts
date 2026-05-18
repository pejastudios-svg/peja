export type Theme = "light" | "dark";
export type Urgency = "critical" | "high" | "medium";
export type MediaType = "image" | "video";

export interface Media {
  url: string;
  type: MediaType;
}

export interface SamplePost {
  id: string;
  isLive: boolean;
  address: string;
  timeAgo: string;
  distance: string;
  category: string;
  urgency: Urgency;
  comment: string;
  tags: string[];
  media: Media[];
  confirmations: number;
  comments: number;
  views: number;
  confirmed?: boolean;
  mapX: number; // 0-100 percent position on the map prototype
  mapY: number;
}

export const SAMPLE_POSTS: SamplePost[] = [
  {
    id: "1",
    isLive: true,
    address: "Allen Avenue, Ikeja",
    timeAgo: "3 min ago",
    distance: "0.8 km",
    category: "Kidnapping",
    urgency: "critical",
    comment:
      "Black Sienna with tinted windows seen blocking traffic and forcing a man into the vehicle. Plate covered. Police called.",
    tags: ["sienna", "ikeja", "urgent"],
    media: [
      { url: "https://picsum.photos/seed/peja-incident-1a/900/540", type: "image" },
      { url: "https://picsum.photos/seed/peja-incident-1b/900/540", type: "image" },
    ],
    confirmations: 24,
    comments: 8,
    views: 1240,
    mapX: 34,
    mapY: 30,
  },
  {
    id: "2",
    isLive: true,
    address: "Surulere, Bode Thomas",
    timeAgo: "12 min ago",
    distance: "2.4 km",
    category: "Armed robbery",
    urgency: "high",
    comment: "Three men on bikes robbing pedestrians near the junction. Avoid area if you can.",
    tags: ["surulere", "bike", "stayaway"],
    media: [{ url: "https://picsum.photos/seed/peja-incident-2/900/540", type: "video" }],
    confirmations: 9,
    comments: 3,
    views: 412,
    mapX: 68,
    mapY: 26,
  },
  {
    id: "3",
    isLive: true,
    address: "Yaba market",
    timeAgo: "27 min ago",
    distance: "3.8 km",
    category: "Suspicious",
    urgency: "medium",
    comment: "Same white van parked on this street for 4 hours. Two men inside watching the shops.",
    tags: ["yaba", "van"],
    media: [
      { url: "https://picsum.photos/seed/peja-incident-3a/900/540", type: "image" },
      { url: "https://picsum.photos/seed/peja-incident-3b/900/540", type: "image" },
      { url: "https://picsum.photos/seed/peja-incident-3c/900/540", type: "image" },
    ],
    confirmations: 4,
    comments: 1,
    views: 188,
    mapX: 74,
    mapY: 70,
  },
  {
    id: "4",
    isLive: false,
    address: "Lekki Phase 1, Admiralty Way",
    timeAgo: "2 hours ago",
    distance: "4.2 km",
    category: "Accident",
    urgency: "medium",
    comment: "Multi-car pileup cleared. Traffic flowing again.",
    tags: ["lekki", "traffic"],
    media: [{ url: "https://picsum.photos/seed/peja-incident-4/900/540", type: "image" }],
    confirmations: 41,
    comments: 12,
    views: 3200,
    confirmed: true,
    mapX: 24,
    mapY: 74,
  },
];

export function getTokens(theme: Theme) {
  if (theme === "dark") {
    return {
      bg: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124, 58, 237, 0.18), transparent), #0a0814",
      surface: "rgba(30, 16, 51, 0.6)",
      surfaceSolid: "#15102a",
      surfaceCard: "rgba(30, 16, 51, 0.85)",
      hairline: "rgba(167, 139, 250, 0.12)",
      hairlineStrong: "rgba(167, 139, 250, 0.2)",
      pillBg: "rgba(50, 25, 80, 0.6)",
      ink: "#fafafa",
      body: "#c4c0d0",
      muted: "#787285",
      mediaPlaceholder: "#1a1530",
      primary: "#a78bfa",
      primaryStrong: "#8b5cf6",
      primaryGlow: "rgba(139, 92, 246, 0.35)",
      primaryTint: "rgba(139, 92, 246, 0.12)",
      success: "#34d399",
      warning: "#fbbf24",
      danger: "#f87171",
      dangerStrong: "#ef4444",
      dangerGlow: "rgba(239, 68, 68, 0.45)",
      live: "#ef4444",
      mapBg: "linear-gradient(135deg, #0f0820 0%, #1a0f30 100%)",
      mapGrid: "rgba(167, 139, 250, 0.07)",
      mapRoad: "rgba(167, 139, 250, 0.18)",
      mapBlock: "rgba(167, 139, 250, 0.04)",
      mapWater: "rgba(100, 130, 200, 0.12)",
    };
  }
  return {
    bg: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124, 58, 237, 0.08), transparent), #efeae0",
    surface: "rgba(255, 255, 255, 0.7)",
    surfaceSolid: "#ffffff",
    surfaceCard: "#ffffff",
    hairline: "#ececec",
    hairlineStrong: "#d4d4d8",
    pillBg: "rgba(255, 255, 255, 0.78)",
    ink: "#0c0a14",
    body: "#52525b",
    muted: "#a1a1aa",
    mediaPlaceholder: "#f4f4f5",
    primary: "#7c3aed",
    primaryStrong: "#6d28d9",
    primaryGlow: "rgba(124, 58, 237, 0.18)",
    primaryTint: "rgba(124, 58, 237, 0.07)",
    success: "#059669",
    warning: "#d97706",
    danger: "#dc2626",
    dangerStrong: "#b91c1c",
    dangerGlow: "rgba(220, 38, 38, 0.22)",
    live: "#dc2626",
    mapBg: "linear-gradient(135deg, #e9e2d2 0%, #ddd4c2 100%)",
    mapGrid: "rgba(60, 40, 20, 0.05)",
    mapRoad: "rgba(255, 255, 255, 0.85)",
    mapBlock: "rgba(255, 255, 255, 0.45)",
    mapWater: "rgba(140, 175, 220, 0.45)",
  };
}

export type Tokens = ReturnType<typeof getTokens>;

export function urgencyToColor(u: Urgency, t: Tokens) {
  if (u === "critical") return t.dangerStrong;
  if (u === "high") return t.warning;
  return t.primary;
}

export function formatCount(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
