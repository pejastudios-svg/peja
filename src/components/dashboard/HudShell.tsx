"use client";

import React from "react";

export default function HudShell({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="peja-hud min-h-screen">
      <div className="p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl hud-title text-dark-100">{title}</h1>
            {subtitle && <p className="hud-subtitle mt-1">{subtitle}</p>}
          </div>
          {right}
        </div>

        {children}
      </div>
    </div>
  );
}