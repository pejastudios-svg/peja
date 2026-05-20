"use client";

// Renders a message's text content with any URLs turned into clickable
// chips. Tapping a link opens the ExternalLinkWarning modal so the user
// can confirm before leaving Peja — anti-phishing, especially since
// chat lets one user nudge another to click anything.
//
// "Remembered" domains: once the user has confirmed a domain in this
// session, future links to the same domain open without re-prompting.
// Stored on `window.__pejaTrustedDomains` so it persists across React
// re-renders but resets on full page reload (intentional — a fresh
// session should re-confirm).

import { useCallback, useState } from "react";
import { ExternalLinkWarningModal } from "./ExternalLinkWarningModal";

// Lightweight URL detection. Catches the common cases users actually
// type: http(s)://, bare www.foo.com, and bare foo.com/path. Not a
// full URL parser — we don't need every RFC edge case, just enough to
// turn the obvious links into clickable affordances.
const URL_REGEX =
  /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"]*)?)/gi;

interface MessageTextProps {
  text: string;
  // Tailwind class for the link colour — sender bubbles use white/yellow,
  // receiver bubbles use primary. Caller picks.
  linkClass?: string;
}

interface Segment {
  type: "text" | "link";
  value: string;
}

function tokenize(text: string): Segment[] {
  const out: Segment[] = [];
  let lastEnd = 0;
  // Reset regex state between renders.
  const re = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastEnd) {
      out.push({ type: "text", value: text.slice(lastEnd, match.index) });
    }
    out.push({ type: "link", value: match[0] });
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < text.length) {
    out.push({ type: "text", value: text.slice(lastEnd) });
  }
  return out;
}

function normalizeUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return "https://" + raw;
}

function hostFromUrl(raw: string): string {
  try {
    return new URL(normalizeUrl(raw)).host;
  } catch {
    return raw;
  }
}

// Same-origin hosts are *not* external — we skip the warning for our
// own peja.life domain since clicking a Peja link doesn't take you off
// the platform.
const INTERNAL_HOSTS = new Set(["peja.life", "www.peja.life", "localhost"]);

function getTrustedDomains(): Set<string> {
  if (typeof window === "undefined") return new Set();
  const w = window as unknown as { __pejaTrustedDomains?: Set<string> };
  if (!w.__pejaTrustedDomains) w.__pejaTrustedDomains = new Set();
  return w.__pejaTrustedDomains;
}

export function MessageText({ text, linkClass }: MessageTextProps) {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const segments = tokenize(text);

  const openUrl = useCallback((url: string) => {
    // Open in a new tab. Capacitor Android handles _blank by opening
    // the system browser; web does its usual.
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  const onLinkClick = useCallback(
    (raw: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const url = normalizeUrl(raw);
      const host = hostFromUrl(url);
      if (INTERNAL_HOSTS.has(host)) {
        openUrl(url);
        return;
      }
      if (getTrustedDomains().has(host)) {
        openUrl(url);
        return;
      }
      setPendingUrl(url);
    },
    [openUrl]
  );

  const onConfirmOpen = useCallback(() => {
    if (!pendingUrl) return;
    const host = hostFromUrl(pendingUrl);
    getTrustedDomains().add(host);
    const u = pendingUrl;
    setPendingUrl(null);
    openUrl(u);
  }, [pendingUrl, openUrl]);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          // React's text node preserves whitespace + newlines because
          // the parent <p> has `whitespace-pre-wrap`.
          return <span key={i}>{seg.value}</span>;
        }
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => onLinkClick(seg.value, e)}
            className={`underline break-all ${linkClass || "text-blue-300"}`}
          >
            {seg.value}
          </button>
        );
      })}
      {pendingUrl && (
        <ExternalLinkWarningModal
          url={pendingUrl}
          onCancel={() => setPendingUrl(null)}
          onConfirm={onConfirmOpen}
        />
      )}
    </>
  );
}
