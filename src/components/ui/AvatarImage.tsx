"use client";

// Small <img> wrapper that swaps to a User-icon fallback when the
// avatar URL fails to load (offline, 404, broken CDN, etc.) — the
// raw `<img src={url}>` pattern keeps showing a broken-image
// placeholder when the network drops, which made the header look
// empty when the user opened the app with no signal.
//
// Falsy URL also routes to the fallback, same behavior as before.

import { useState } from "react";
import { User } from "lucide-react";

interface Props {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  // Pass-through styling for the wrapping span — used by callers
  // that want a colored background / border around the avatar slot.
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  // Fallback icon size. Defaults to a slightly smaller stroke so
  // it visually sits inside the same circular slot.
  fallbackIconClassName?: string;
}

export function AvatarImage({
  src,
  alt = "",
  className = "w-full h-full object-cover",
  wrapperClassName = "",
  wrapperStyle,
  fallbackIconClassName = "w-3.5 h-3.5",
}: Props) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;

  return (
    <span
      className={wrapperClassName}
      style={wrapperStyle}
    >
      {showFallback ? (
        <User
          className={fallbackIconClassName}
          style={{ color: "var(--color-dark-400)" }}
        />
      ) : (
        <img
          src={src}
          alt={alt}
          className={className}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
