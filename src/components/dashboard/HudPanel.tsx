"use client";

import React from "react";

export default function HudPanel({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`hud-panel ${className}`}>
      {(title || right) && (
        <div className="hud-panel-header px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <p className="text-sm font-semibold text-dark-100">{title}</p>}
            {subtitle && <p className="text-xs text-dark-500 mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}