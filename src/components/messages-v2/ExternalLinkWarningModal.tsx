"use client";

// Anti-phishing speed bump for external links shared in chat. Anyone
// can paste any URL into a conversation — this modal makes the user
// pause and read where they're about to go before tapping through to
// a site outside Peja.
//
// Pattern matches what every consumer messaging app does (WhatsApp,
// Slack, Discord all show a "this link will take you to ___" warning
// for unknown domains). Once the user confirms once, the parent
// MessageText component remembers the domain for the session so
// repeat clicks don't nag.

import { useEffect } from "react";
import { AlertTriangle, ExternalLink, X } from "lucide-react";

interface Props {
  url: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ExternalLinkWarningModal({ url, onCancel, onConfirm }: Props) {
  const host = hostOf(url);

  // Close on Escape so keyboard users can dismiss without reaching for
  // the mouse / a tap target.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--page-bg)] border border-white/10 rounded-2xl max-w-sm w-full p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-yellow-500/15 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-dark-100">
              Leaving Peja
            </h2>
            <p className="text-sm text-dark-400 mt-1">
              This link will take you to an outside site. Make sure you trust
              the sender and that the destination is safe before continuing.
            </p>
            <div className="mt-3 p-2.5 rounded-lg bg-white/5 border border-white/10">
              <p className="text-[11px] uppercase tracking-wide text-dark-500">
                Destination
              </p>
              <p className="text-sm font-medium text-dark-100 truncate">
                {host}
              </p>
              <p className="text-[11px] text-dark-500 mt-0.5 break-all">
                {url}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-dark-300" />
          </button>
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-dark-100 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 h-10 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
