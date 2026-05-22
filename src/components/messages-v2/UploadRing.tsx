"use client";

// Circular progress ring for an in-flight chat-media upload.
//
// Renders as an SVG arc whose stroke-dashoffset is driven by the
// `fraction` (0..1) prop. The centre shows either a tap-target X to
// cancel the upload (when `onCancel` is wired) or the integer
// percentage (read-only).
//
// `size` lets the same ring scale into different surfaces:
//   • 56px — over image / video bubbles (the default)
//   • 44px — in place of the AudioBubble play button
//   • 40px — in place of the DocumentBubble file icon
//
// `showLabel` controls the chip beneath the ring ("Uploading 35%").
// Off by default — useful over a big media tile, distracting over a
// small inline file/audio bubble.

import { X } from "lucide-react";

interface Props {
  fraction: number;
  size?: number;
  showLabel?: boolean;
  label?: string;
  onCancel?: () => void;
}

export function UploadRing({
  fraction,
  size = 56,
  showLabel = false,
  label,
  onCancel,
}: Props) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const pct = Math.round(clamped * 100);
  // Stroke width scales with size so the ring stays proportional from
  // 40px all the way up to 56px.
  const stroke = Math.max(2, Math.round(size * 0.055));
  const radius = size / 2 - stroke - 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const innerBtnSize = Math.round(size * 0.64);
  const iconSize = Math.max(12, Math.round(innerBtnSize * 0.45));

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="white"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.2s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {onCancel ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="rounded-full bg-black/45 hover:bg-black/60 flex items-center justify-center transition-colors"
              style={{ width: innerBtnSize, height: innerBtnSize }}
              aria-label="Cancel upload"
            >
              <X
                className="text-white"
                style={{ width: iconSize, height: iconSize }}
              />
            </button>
          ) : (
            <span className="text-[11px] font-semibold text-white">{pct}%</span>
          )}
        </div>
      </div>
      {showLabel && (
        <span className="text-[10px] text-white/90 bg-black/40 px-1.5 py-0.5 rounded">
          {label ? label : `${pct}%`}
        </span>
      )}
    </div>
  );
}
