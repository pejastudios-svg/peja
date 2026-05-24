import type { ReactNode } from "react";
import {
  AlertTriangle,
  Flame,
  UserX,
  Skull,
  Info,
} from "lucide-react";

export const REPORT_CATEGORY_ICONS: Record<string, ReactNode> = {
  crime: <AlertTriangle className="w-4 h-4" />,
  fire: <Flame className="w-4 h-4" />,
  kidnapping: <UserX className="w-4 h-4" />,
  terrorist: <Skull className="w-4 h-4" />,
  general: <Info className="w-4 h-4" />,
};

export const REPORT_CATEGORY_COLORS: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  crime: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.4)", text: "#f87171" },
  fire: { bg: "rgba(249,115,22,0.12)", border: "rgba(249,115,22,0.4)", text: "#fb923c" },
  kidnapping: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.4)", text: "#f87171" },
  terrorist: { bg: "rgba(220,38,38,0.15)", border: "rgba(220,38,38,0.45)", text: "#ef4444" },
  general: { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.4)", text: "#60a5fa" },
};
