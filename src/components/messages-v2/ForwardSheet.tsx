"use client";

// Recipient picker for "Forward message". Renders the user's
// conversation list with multi-select checkboxes + a search box.
// Bottom CTA fires the parent-supplied onForward(selectedIds[]).
//
// We deliberately don't fetch — the v2 store already keeps the full
// conversation list in memory once the user has signed in. This
// component just reads from it.

import { useMemo, useState } from "react";
import { ArrowLeft, Search, Send, User, Check } from "lucide-react";
import { useChatStore } from "@/features/chat/store";

interface Props {
  excludeConversationId?: string;
  onClose: () => void;
  onForward: (conversationIds: string[]) => Promise<void> | void;
}

export function ForwardSheet({ excludeConversationId, onClose, onForward }: Props) {
  const conversationsById = useChatStore((s) => s.conversationsById);
  const order = useChatStore((s) => s.conversationOrder);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const items = useMemo(() => {
    return order
      .map((id) => conversationsById[id])
      .filter((c) => !!c && c.id !== excludeConversationId)
      .filter((c) => {
        if (!query.trim()) return true;
        const name = (c.other_user_name || "").toLowerCase();
        return name.includes(query.trim().toLowerCase());
      });
  }, [order, conversationsById, query, excludeConversationId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onForward(Array.from(selected));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[var(--page-bg)] flex flex-col">
      <header className="shrink-0 flex items-center gap-3 px-4 h-14 border-b border-[var(--chat-input-border)]">
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-[var(--chat-input-bg)] flex items-center justify-center"
          aria-label="Close"
        >
          <ArrowLeft className="w-5 h-5 text-dark-200" />
        </button>
        <span className="text-base font-semibold text-dark-100">
          Forward to…
        </span>
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
        {items.length === 0 ? (
          <p className="text-sm text-dark-400 text-center py-8">
            {query.trim() ? "No matches." : "No other chats yet."}
          </p>
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
                    <span className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center">
                      {c.other_user_avatar_url ? (
                        <img
                          src={c.other_user_avatar_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-5 h-5 text-dark-400" />
                      )}
                    </span>
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
                ? "Select chats to forward"
                : `Forward to ${selected.size} chat${selected.size > 1 ? "s" : ""}`}
          </span>
        </button>
      </div>
    </div>
  );
}
