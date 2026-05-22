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

// Lightweight URL + mention detection. Catches:
//   • URLs: http(s)://, bare www.foo.com, bare foo.com/path
//   • Mentions: @everyone (case-insensitive) — and @<word> tokens
//     which we style as a mention pill. We don't try to resolve to a
//     specific user here; the styling alone is enough to make a
//     mention visually salient. The composer enforces that picks
//     produce single-token names so this regex matches what it
//     inserted.
const URL_PATTERN =
  /https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"]*)?/gi;
const MENTION_PATTERN = /(^|\s)(@everyone|@[A-Za-z][A-Za-z0-9_'-]*)/g;

interface MessageTextProps {
  text: string;
  // Tailwind class for the link colour — sender bubbles use white/yellow,
  // receiver bubbles use primary. Caller picks.
  linkClass?: string;
  // Tailwind class for mention pills. Default falls back to a generic
  // primary-tinted pill; sender bubbles can override.
  mentionClass?: string;
}

interface Segment {
  type: "text" | "link" | "mention";
  value: string;
}

function tokenize(text: string): Segment[] {
  // Two-pass tokenizer: first pull out URLs (longest match wins),
  // then scan the remaining "text" segments for mentions. URL-first
  // keeps "@" inside URLs from being mis-tagged.
  const urlSegs: Segment[] = [];
  let lastEnd = 0;
  const urlRe = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > lastEnd) {
      urlSegs.push({ type: "text", value: text.slice(lastEnd, m.index) });
    }
    urlSegs.push({ type: "link", value: m[0] });
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    urlSegs.push({ type: "text", value: text.slice(lastEnd) });
  }

  const out: Segment[] = [];
  for (const seg of urlSegs) {
    if (seg.type !== "text") {
      out.push(seg);
      continue;
    }
    const sub = seg.value;
    let subLast = 0;
    const mentionRe = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags);
    let mm: RegExpExecArray | null;
    while ((mm = mentionRe.exec(sub)) !== null) {
      // mm[1] is the leading whitespace (or empty at string start);
      // mm[2] is the actual mention token. Emit the prefix + token
      // separately so the styling lands on the @… only.
      const prefix = mm[1];
      const mention = mm[2];
      const fullStart = mm.index + prefix.length;
      if (fullStart > subLast) {
        out.push({ type: "text", value: sub.slice(subLast, fullStart) });
      }
      out.push({ type: "mention", value: mention });
      subLast = fullStart + mention.length;
    }
    if (subLast < sub.length) {
      out.push({ type: "text", value: sub.slice(subLast) });
    }
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

export function MessageText({ text, linkClass, mentionClass }: MessageTextProps) {
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
        if (seg.type === "mention") {
          return (
            <span
              key={i}
              className={mentionClass || "peja-mention"}
            >
              {seg.value}
            </span>
          );
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
