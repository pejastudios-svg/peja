"use client";

import { Eye, EyeOff } from "lucide-react";

interface ReportSensitiveRowProps {
  isSensitive: boolean;
  onToggle: () => void;
}

export function ReportSensitiveRow({ isSensitive, onToggle }: ReportSensitiveRowProps) {
  return (
    <section className="report-section">
      <button type="button" onClick={onToggle} className="report-list-row">
        <div
          className="report-list-row-icon"
          style={{
            background: isSensitive ? "rgba(249, 115, 22, 0.12)" : undefined,
            borderColor: isSensitive ? "rgba(249, 115, 22, 0.35)" : undefined,
          }}
        >
          {isSensitive ? (
            <EyeOff className="w-5 h-5 text-orange-400" />
          ) : (
            <Eye className="w-5 h-5 text-dark-500" />
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p
            className="text-sm font-medium"
            style={{ color: isSensitive ? "#fb923c" : "var(--color-dark-100)" }}
          >
            {isSensitive ? "Mark as sensitive" : "Safe for all audiences"}
          </p>
          <p className="text-xs text-dark-500 mt-0.5 leading-snug">
            Enable if the media shows blood, injuries, or other disturbing content
          </p>
        </div>
        <div
          className="w-11 h-6 rounded-full relative shrink-0 transition-colors"
          style={{
            background: isSensitive ? "rgba(249, 115, 22, 0.5)" : "var(--border-default)",
          }}
          aria-hidden
        >
          <div
            className="absolute top-0.5 w-5 h-5 rounded-full transition-all shadow-sm"
            style={{
              left: isSensitive ? "calc(100% - 22px)" : "2px",
              background: isSensitive ? "#fb923c" : "var(--color-dark-500)",
            }}
          />
        </div>
      </button>
    </section>
  );
}
