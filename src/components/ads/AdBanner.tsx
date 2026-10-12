"use client";

import { gradientCss } from "@/lib/ads";

/**
 * The Featured banner.
 *
 * Composed by peja from the advertiser's logo, name and one line, over a
 * gradient they picked. Nothing is uploaded and nothing is generated.
 *
 * That choice does two jobs: a shop with no designer is not shut out of
 * the most expensive tier, and the carousel reads as one coherent surface
 * instead of a pile of mismatched flyers.
 *
 * The outline is always present and always drawn in the app's own border
 * colour, which inverts between themes. One rule, so any gradient
 * separates cleanly from the page in light and dark without a lookup
 * table of per-colour exceptions.
 */
export function AdBanner({
  businessName,
  text,
  gradient,
  logoUrl,
  compact,
}: {
  businessName: string;
  text?: string | null;
  gradient?: string | null;
  logoUrl?: string | null;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl ${compact ? "p-3.5" : "p-5"}`}
      style={{
        background: gradientCss(gradient),
        border: "1px solid var(--glass-border)",
      }}
    >
      <div className="flex items-center gap-3">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className={`${compact ? "w-10 h-10" : "w-14 h-14"} rounded-xl object-cover bg-white/20 shrink-0`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={`font-bold text-white truncate ${compact ? "text-sm" : "text-lg"}`}
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}
          >
            {businessName}
          </p>
          {text && (
            <p
              className={`text-white/90 mt-0.5 ${compact ? "text-xs" : "text-sm"} line-clamp-2`}
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}
            >
              {text}
            </p>
          )}
        </div>
      </div>

      <span className="absolute bottom-2 right-3 text-[10px] font-semibold uppercase tracking-wide text-white/70">
        Sponsored
      </span>
    </div>
  );
}
