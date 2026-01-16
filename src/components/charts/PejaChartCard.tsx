"use client";

import React from "react";
import { ResponsiveContainer } from "recharts";

export default function PejaChartCard({
  title,
  subtitle,
  right,
  children,
  height = 220,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <div className="sec-card p-4">
      <div className="sec-card-header pb-3 mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-dark-100">{title}</p>
          {subtitle && <p className="text-xs text-dark-500 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as any}
        </ResponsiveContainer>
      </div>
    </div>
  );
}