"use client";

// Search-within-a-chat sheet. Slides in from the right (matches
// ChatInfoSheet) and exposes a debounced search input + scrolling
// results list. Each result shows: sender name, snippet (with the
// match highlighted), and a timestamp. Tapping a result fires
// onJumpTo with the message id; the chat page tries to scroll to
// that message in the currently-rendered thread, and falls back to
// a toast if it's not loaded yet (we don't auto-paginate-to-result
// in v1 — that's a follow-up).

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { searchMessagesInConversation } from "@/features/chat/api";
import {
  formatChatPreview,
  extractIncidentPostId,
  IncidentDescriptionSnippet,
} from "@/components/messages-v2/IncidentLinkPreview";
import type { ChatMessage } from "@/features/chat/types";

interface Props {
  conversationId: string;
  currentUserId: string;
  otherUserName: string | null;
  onClose: () => void;
  onJumpTo: (messageId: string) => void;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

export function SearchInChatSheet({
  conversationId,
  currentUserId,
  otherUserName,
  onClose,
  onJumpTo,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryRef = useRef("");

  // Autofocus the input on mount — searching is the whole reason
  // this sheet is open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search. We track the latest query in a ref so stale
  // in-flight responses can detect they're stale and bail.
  useEffect(() => {
    queryRef.current = query;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const snapshot = trimmed;
      try {
        const rows = await searchMessagesInConversation(
          conversationId,
          currentUserId,
          snapshot,
          50
        );
        // Drop stale result from an earlier query that resolved late.
        if (queryRef.current.trim() !== snapshot) return;
        setResults(rows);
      } finally {
        if (queryRef.current.trim() === snapshot) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, conversationId, currentUserId]);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose(), 220);
  }, [closing, onClose]);

  return (
    <div
      className={`fixed inset-0 z-[58] bg-[var(--page-bg)] flex flex-col ${
        closing ? "peja-slide-out-to-right" : "peja-slide-in-from-right"
      }`}
    >
      <header className="shrink-0 flex items-center gap-3 px-3 h-14 border-b border-[var(--chat-input-border)]">
        <button
          type="button"
          onClick={handleClose}
          className="w-9 h-9 rounded-full bg-[var(--chat-input-bg)] flex items-center justify-center"
          aria-label="Close"
        >
          <ArrowLeft className="w-5 h-5 text-dark-200" />
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search in chat${otherUserName ? ` with ${otherUserName}` : ""}`}
            className="w-full h-10 rounded-xl bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] pl-9 pr-9 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[var(--chat-input-hover)] flex items-center justify-center"
              aria-label="Clear search"
            >
              <X className="w-3 h-3 text-dark-200" />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {query.trim().length < MIN_QUERY_LEN ? (
          <p className="text-sm text-dark-400 text-center py-12">
            Type at least {MIN_QUERY_LEN} characters to search.
          </p>
        ) : loading ? (
          <p className="text-sm text-dark-400 text-center py-12">Searching…</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-dark-400 text-center py-12">
            No matches.
          </p>
        ) : (
          <ul className="space-y-1">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    onJumpTo(r.id);
                    handleClose();
                  }}
                  className="w-full flex flex-col items-start gap-1 px-3 py-2.5 rounded-xl hover:bg-[var(--chat-input-hover)] text-left"
                >
                  <span className="flex items-center gap-2 text-[11px] text-dark-400 tabular-nums">
                    <span>
                      {r.sender_id === currentUserId ? "You" : otherUserName || "User"}
                    </span>
                    <span>·</span>
                    <span>{formatResultTime(r.created_at)}</span>
                  </span>
                  <Snippet
                    text={formatChatPreview(r.content) || ""}
                    query={query.trim()}
                  />
                  {(() => {
                    // Incident-share results collapse to "📢 Shared
                    // an incident" via formatChatPreview, which hides
                    // the post's actual description. Pull it back in
                    // as a secondary line so the user can recognise
                    // what was forwarded.
                    const incidentId = extractIncidentPostId(r.content);
                    if (!incidentId) return null;
                    return <IncidentDescriptionSnippet postId={incidentId} />;
                  })()}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Highlight every case-insensitive match of `query` inside `text`,
 * keeping the surrounding context legible. Truncates long messages
 * around the first match so the row doesn't overflow.
 */
function Snippet({ text, query }: { text: string; query: string }) {
  if (!text) return <span className="text-sm text-dark-400 italic">(no text)</span>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const firstIdx = lower.indexOf(q);
  // Window the snippet around the first match so we don't render
  // 1000-character messages in full inside the list.
  const WINDOW = 60;
  let start = 0;
  let end = text.length;
  if (firstIdx >= 0 && text.length > WINDOW * 2) {
    start = Math.max(0, firstIdx - WINDOW);
    end = Math.min(text.length, firstIdx + q.length + WINDOW);
  }
  const windowed = text.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";

  // Split the windowed text on each match for highlight markup.
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  const lowerWindow = windowed.toLowerCase();
  while (cursor < windowed.length) {
    const hit = lowerWindow.indexOf(q, cursor);
    if (hit === -1) {
      parts.push({ text: windowed.slice(cursor), match: false });
      break;
    }
    if (hit > cursor) {
      parts.push({ text: windowed.slice(cursor, hit), match: false });
    }
    parts.push({
      text: windowed.slice(hit, hit + q.length),
      match: true,
    });
    cursor = hit + q.length;
  }

  return (
    <span className="text-sm text-dark-100 line-clamp-2 break-words">
      {prefix}
      {parts.map((p, i) =>
        p.match ? (
          <mark
            key={i}
            className="bg-primary-500/30 text-primary-200 rounded px-0.5"
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
      {suffix}
    </span>
  );
}

function formatResultTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return format(d, "HH:mm");
  if (d.getFullYear() === now.getFullYear()) return format(d, "MMM d, HH:mm");
  return format(d, "MMM d yyyy");
}
