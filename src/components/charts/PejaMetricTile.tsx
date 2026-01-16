"use client";

import React from "react";

export default function PejaMetricTile({
  label,
  value,
  icon,
  accent = "purple",
  hint,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: "purple" | "red" | "orange" | "green" | "blue";
  hint?: string;
}) {
  const accentMap = {
    purple: "bg-primary-600/10 text-primary-300 border-primary-500/20",
    red: "bg-red-500/10 text-red-300 border-red-500/20",
    orange: "bg-orange-500/10 text-orange-300 border-orange-500/20",
    green: "bg-green-500/10 text-green-300 border-green-500/20",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  };

  return (
    <div className="sec-card p-4">
      <div className="flex items-center gap-3">
        <div className={`p-3 rounded-xl border ${accentMap[accent]}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-dark-100">{value}</p>
          <p className="text-xs text-dark-500">{label}</p>
          {hint && <p className="text-[11px] text-dark-500 mt-1">{hint}</p>}
        </div>
      </div>
    </div>
  );
}