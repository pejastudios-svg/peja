"use client";

// Small <img> wrapper that swaps to a fallback element when the
// avatar URL fails to load (offline, 404, broken CDN, etc.) — the
// raw `<img src={url}>` pattern keeps showing a broken-image
// placeholder when the network drops, which made the header look
// empty when the user opened the app with no signal.
//
// Falsy URL also routes to the fallback, same behavior as before.
//
// Default fallback is the lucide User icon. Pass a custom `fallback`
// node when the call site needs something else (e.g. a Users icon
// for groups, initials, etc).

import { useEffect, useState, type ReactNode } from "react";
import { User } from "lucide-react";

interface Props {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  // Pass-through styling for the wrapping span — used by callers
  // that want a colored background / border around the avatar slot.
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  // Custom fallback element. When omitted, the default User icon is
  // used (styled via fallbackIconClassName).
  fallback?: ReactNode;
  // Fallback icon size. Only honored when `fallback` is unset.
  fallbackIconClassName?: string;
}

export function AvatarImage({
  src,
  alt = "",
  className = "w-full h-full object-cover",
  wrapperClassName = "",
  wrapperStyle,
  fallback,
  fallbackIconClassName = "w-3.5 h-3.5",
}: Props) {
  const [failed, setFailed] = useState(false);

  // Reset the fail flag when src changes — a freshly-updated avatar
  // after a previous load failure should get its chance to render.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showFallback = !src || failed;

  return (
    <span
      className={wrapperClassName}
      style={wrapperStyle}
    >
      {showFallback ? (
        fallback ?? (
          <User
            className={fallbackIconClassName}
            style={{ color: "var(--color-dark-400)" }}
          />
        )
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
