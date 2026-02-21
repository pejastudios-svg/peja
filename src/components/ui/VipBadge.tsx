"use client";

import { Crown } from "lucide-react";

interface VipBadgeProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  showLabel?: boolean;
}

export function VipBadge({ size = "md", className = "", showLabel = false }: VipBadgeProps) {
  const sizes = {
    sm: { icon: "w-3 h-3", badge: "px-1.5 py-0.5 text-[10px] gap-0.5" },
    md: { icon: "w-3.5 h-3.5", badge: "px-2 py-0.5 text-xs gap-1" },
    lg: { icon: "w-4 h-4", badge: "px-2.5 py-1 text-sm gap-1.5" },
  };

  const s = sizes[size];

  return (
    <span
      className={`vip-badge inline-flex items-center ${s.badge} rounded-full font-bold ${className}`}
    >
      <Crown className={`${s.icon} text-purple-300`} />
      {showLabel && <span>VIP</span>}
    </span>
  );
}