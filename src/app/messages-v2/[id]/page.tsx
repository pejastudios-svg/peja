"use client";

// v2 chat thread. Reads everything from the chat store. Writes go through
// useSendMessage which handles UUID-based optimistic + DB confirm + retry.
// Realtime updates flow in via the global channel (started by useChatInit
// on the list page or on this page if entered directly).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Send } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "@/features/chat/store";
import { useChatInit } from "@/features/chat/useChatInit";
import { fetchThread, markConversationRead } from "@/features/chat/api";
import { useSendMessage } from "@/features/chat/useSendMessage";
import { useToast } from "@/context/ToastContext";

export default function ThreadV2Page() {
  const params = useParams();
  const conversationId = String(params?.id || "");
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  useChatInit();

  const thread = useChatStore((s) => s.threadsByConversation[conversationId]);
  const conv = useChatStore((s) => s.conversationsById[conversationId]);
  const setThread = useChatStore((s) => s.setThread);
  const clearUnread = useChatStore((s) => s.clearUnread);

  const send = useSendMessage();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial fetch + mark-as-read on mount. The store already has whatever
  // realtime has been receiving since the user signed in, so the messages
  // render instantly from cached state — this fetch just refreshes.
  useEffect(() => {
    if (!user?.id || !conversationId) return;
    fetchThread(conversationId, user.id)
      .then((msgs) => setThread(conversationId, msgs))
      .catch(() => {});
    markConversationRead(conversationId, user.id).catch(() => {});
    clearUnread(conversationId);
  }, [user?.id, conversationId, setThread, clearUnread]);

  const messages = useMemo(() => thread?.messages || [], [thread?.messages]);

  // Auto-scroll on new message. Cheap heuristic — always scroll to the
  // bottom when message count changes. Will refine in Phase 7 to handle
  // user scroll position properly.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || !conversationId || sending) return;
    setDraft("");
    setSending(true);
    try {
      await send(conversationId, content);
    } catch {
      toast.danger("Failed to send. Tap the message to retry.");
    } finally {
      setSending(false);
    }
  }, [draft, conversationId, send, sending, toast]);

  return (
    <div className="fixed inset-0 flex flex-col bg-[var(--page-bg)]">
      <Header
        variant="back"
        title={conv?.other_user_name || "Chat"}
        onBack={() => router.push("/messages-v2")}
      />

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain pt-app-header-pill px-4 pb-3"
      >
        {!user && (
          <p className="text-sm text-dark-400 py-12 text-center">Sign in to view this chat.</p>
        )}

        {user && thread && !thread.hydrated && messages.length === 0 && (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
              >
                <div className="h-10 w-40 bg-white/5 rounded-2xl animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {user && messages.length > 0 && (
          <div className="space-y-2 py-3">
            {messages.map((m) => {
              const isMine = m.sender_id === user.id;
              return (
                <div
                  key={m.id}
                  className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
                      isMine
                        ? "bg-primary-600 text-white"
                        : "bg-white/10 text-dark-100"
                    } ${m.delivery_status === "failed" ? "opacity-60 border border-red-500/60" : ""}`}
                  >
                    {m.is_deleted ? (
                      <p className="text-sm italic opacity-70">Message deleted</p>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {m.content}
                      </p>
                    )}
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className={`text-[10px] ${isMine ? "text-white/70" : "text-dark-500"}`}>
                        {format(new Date(m.created_at), "HH:mm")}
                      </span>
                      {isMine && (
                        <span className={`text-[10px] ${isMine ? "text-white/70" : "text-dark-500"}`}>
                          {m.delivery_status === "pending" && "..."}
                          {m.delivery_status === "sent" && "✓"}
                          {m.delivery_status === "seen" && "✓✓"}
                          {m.delivery_status === "failed" && "!"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <div
        className="border-t border-white/5 bg-[var(--page-bg)] px-3 py-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        <div className="flex items-end gap-2 max-w-2xl mx-auto">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Message"
            rows={1}
            className="flex-1 max-h-32 resize-none rounded-2xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            className="shrink-0 w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
