"use client";

// "Forward this incident to a chat" picker. Mounted from PostCard
// behind the MVP/VIP/admin gate. Differs from messages-v2's
// ForwardSheet in one important way: it doesn't depend on the v2
// chat store being hydrated. PostCard lives on /feed, /map, /post,
// etc. — pages that don't mount useChatInit — so this sheet
// fetches the user's conversation list on its own.
//
// What gets sent: a plain-text message containing the incident's
// public URL plus an optional short caption. The chat thread on
// the receiving end will render that URL as a normal link bubble
// (or, once incident link previews are wired up, as an inline
// incident card).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Search, Send, Check } from "lucide-react";
import { AvatarImage } from "@/components/ui/AvatarImage";
import { v4 as uuidv4 } from "uuid";
import { fetchConversationList, sendTextMessage } from "@/features/chat/api";
import type { ChatConversationSummary } from "@/features/chat/types";

interface Props {
  currentUserId: string;
  // The full message body that will be inserted into the picked
  // conversations. Caller assembles it (URL + optional caption).
  messageBody: string;
  onClose: () => void;
  onSent?: (count: number) => void;
  onError?: (err: unknown) => void;
}

export function IncidentForwardSheet({
  currentUserId,
  messageBody,
  onClose,
  onSent,
  onError,
}: Props) {
  const [conversations, setConversations] = useState<
    ChatConversationSummary[] | null
  >(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchConversationList(currentUserId)
      .then((rows) => {
        if (!cancelled) setConversations(rows);
      })
      .catch(() => {
        if (!cancelled) setConversations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const items = useMemo(() => {
    if (!conversations) return null;
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => !c.is_blocked)
      .filter((c) => {
        if (!q) return true;
        return (c.other_user_name || "").toLowerCase().includes(q);
      });
  }, [conversations, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose(), 200);
  };

  const handleSend = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      const ids = Array.from(selected);
      // Fire all sends in parallel. Each gets its own client-side
      // id so optimistic store entries on the receiving thread
      // don't collide.
      await Promise.all(
        ids.map((conversationId) =>
          sendTextMessage({
            id: uuidv4(),
            conversation_id: conversationId,
            sender_id: currentUserId,
            content: messageBody,
          })
        )
      );
      onSent?.(ids.length);
      handleClose();
    } catch (err) {
      onError?.(err);
    } finally {
      setSubmitting(false);
    }
  };

  // Portal to <body> so the sheet escapes any ancestor that creates a
  // containing block (PostCard's <article> has overflow-hidden + a
  // CSS transition, which clipped a previously-inline-rendered sheet
  // and made the bottom button overflow off-screen). Stopping click
  // propagation at the root also prevents back-arrow / list taps from
  // bubbling into the underlying PostCard's onClick → /post/[id]
  // navigation.
  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      onClick={(e) => e.stopPropagation()}
      // z-[10001] sits above FullScreenModalShell's zIndex={9999}
      // used by the @modal/(.)post/[id] intercepting route. Without
      // that, opening the forward sheet from a post that was itself
      // opened as a modal (chat link, map pin, etc.) renders the
      // sheet BEHIND the post modal — visually nothing happens.
      className={`fixed inset-0 z-[10001] bg-[var(--page-bg)] flex flex-col overflow-hidden ${
        closing ? "peja-slide-out-to-right" : "peja-slide-in-from-right"
      }`}
    >
      {/* Header respects safe-area top inset so the title row doesn't
          sit under the notch / status bar on iOS Capacitor builds. */}
      <header
        className="shrink-0 border-b border-[var(--chat-input-border)]"
        style={{
          paddingTop: "var(--app-top-inset, env(safe-area-inset-top, 0px))",
        }}
      >
        <div className="flex items-center gap-3 px-4 h-14">
          <button
            type="button"
            onClick={handleClose}
            className="w-9 h-9 rounded-full bg-[var(--chat-input-bg)] flex items-center justify-center"
            aria-label="Close"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <span className="text-base font-semibold text-dark-100">
            Send incident to…
          </span>
        </div>
      </header>

      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full h-10 rounded-xl bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] pl-9 pr-3 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {items === null ? (
          <p className="text-sm text-dark-400 text-center py-12">Loading…</p>
        ) : items.length === 0 ? (
          <div className="text-center py-12 px-6">
            <p className="text-sm text-dark-300 mb-1">
              {query.trim()
                ? `No matches for "${query}".`
                : "You don't have any chats yet."}
            </p>
            {!query.trim() && (
              <p className="text-[11px] text-dark-500">
                Start a DM from the messages tab first, then come back here
                to forward.
              </p>
            )}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {items.map((c) => {
              const isSelected = selected.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[var(--chat-input-hover)] text-left"
                  >
                    <AvatarImage
                      src={c.other_user_avatar_url}
                      wrapperClassName="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center"
                      fallbackIconClassName="w-5 h-5"
                    />
                    <span className="flex-1 min-w-0 text-sm text-dark-100 truncate">
                      {c.other_user_name || "Chat"}
                    </span>
                    <span
                      className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center border ${
                        isSelected
                          ? "bg-primary-600 border-primary-600 text-white"
                          : "border-[var(--chat-input-border)]"
                      }`}
                      aria-hidden
                    >
                      {isSelected && <Check className="w-4 h-4" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-[var(--chat-input-border)] bg-[var(--page-bg)]">
        <button
          type="button"
          onClick={handleSend}
          disabled={selected.size === 0 || submitting}
          className="w-full h-11 rounded-xl bg-primary-600 text-white font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
          <span>
            {submitting
              ? "Sending…"
              : selected.size === 0
                ? "Select chats to send to"
                : `Send to ${selected.size} chat${selected.size > 1 ? "s" : ""}`}
          </span>
        </button>
      </div>
    </div>,
    document.body
  );
}
