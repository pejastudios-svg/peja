"use client";

import React from "react";

export default function HudShell({
  title,
  subtitle,
  right,
  children,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasHeader = Boolean(title || subtitle || right);
  return (
    <div className="peja-hud min-h-screen">
      <div className="px-6 pb-6 pt-32">
        {hasHeader && (
          <div className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="min-w-0">
              {title && <h1 className="text-2xl md:text-3xl hud-title text-dark-100">{title}</h1>}
              {subtitle && <p className="hud-subtitle mt-1">{subtitle}</p>}
            </div>
            {right && <div className="shrink-0">{right}</div>}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}