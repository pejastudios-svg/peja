"use client";

// Global search across every conversation the user is in. Fired
// from the conversation-list page's header search icon. Same
// slide-in/out animation as the in-chat search sheet for visual
// consistency.
//
// Tapping a result navigates to the chat with `?focus=<messageId>`
// appended; the thread page reads that param on mount and walks
// pagination backward until the target message is loaded, then
// scrolls + highlight-flashes it.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { format, isSameDay } from "date-fns";
import {
  searchMessagesGlobally,
  type CrossChatSearchResult,
} from "@/features/chat/api";
import {
  formatChatPreview,
  extractIncidentPostId,
  IncidentDescriptionSnippet,
} from "@/components/messages-v2/IncidentLinkPreview";

interface Props {
  currentUserId: string;
  onClose: () => void;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

export function SearchAllChatsSheet({ currentUserId, onClose }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CrossChatSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryRef = useRef("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
        const rows = await searchMessagesGlobally(currentUserId, snapshot, 50);
        if (queryRef.current.trim() !== snapshot) return;
        setResults(rows);
      } finally {
        if (queryRef.current.trim() === snapshot) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, currentUserId]);

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
      {/* Header: respects safe-area top inset so search bar isn't
          clipped under the notch / status bar. */}
      <header
        className="shrink-0 border-b border-[var(--chat-input-border)]"
        style={{
          paddingTop: "var(--app-top-inset, env(safe-area-inset-top, 0px))",
        }}
      >
       <div className="flex items-center gap-3 px-3 h-14">
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
            placeholder="Search all messages"
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
       </div>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {query.trim().length < MIN_QUERY_LEN ? (
          <p className="text-sm text-dark-400 text-center py-12">
            Type at least {MIN_QUERY_LEN} characters to search across your
            chats.
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
                    // Hand the message id over to the thread page via
                    // a query param. The thread page reads `?focus=`,
                    // auto-paginates backward until the message is in
                    // the rendered window, and scrolls + flashes it.
                    router.push(
                      `/messages/${r.conversation_id}?focus=${encodeURIComponent(
                        r.id
                      )}`
                    );
                    handleClose();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--chat-input-hover)] text-left"
                >
                  <AvatarImage
                    src={r.other_user_avatar_url}
                    wrapperClassName="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center"
                    fallbackIconClassName="w-5 h-5"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 text-[11px] text-dark-400 tabular-nums">
                      <span className="text-dark-200 font-medium truncate max-w-[12rem]">
                        {r.other_user_name || "Chat"}
                      </span>
                      <span>·</span>
                      <span>{formatResultTime(r.created_at)}</span>
                      {r.sender_id === currentUserId && (
                        <>
                          <span>·</span>
                          <span>You</span>
                        </>
                      )}
                    </span>
                    <Snippet
                      text={formatChatPreview(r.content) || ""}
                      query={query.trim()}
                    />
                    {(() => {
                      const incidentId = extractIncidentPostId(r.content);
                      if (!incidentId) return null;
                      return (
                        <IncidentDescriptionSnippet postId={incidentId} />
                      );
                    })()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Snippet({ text, query }: { text: string; query: string }) {
  if (!text)
    return (
      <span className="block text-sm text-dark-400 italic">(no text)</span>
    );
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const firstIdx = lower.indexOf(q);
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
    <span className="block text-sm text-dark-100 line-clamp-2 break-words">
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
