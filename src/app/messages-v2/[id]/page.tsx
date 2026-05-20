"use client";

// v2 chat thread. Reads everything from the chat store. Writes go through
// useSendMessage which handles UUID-based optimistic + DB confirm + retry.
// Realtime updates flow in via the global channel (started by useChatInit
// on the list page or on this page if entered directly).

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Send } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "@/features/chat/store";
import { useChatInit } from "@/features/chat/useChatInit";
import { fetchThread, markConversationRead } from "@/features/chat/api";
import { useSendMessage } from "@/features/chat/useSendMessage";
import { retryOutboxItem } from "@/features/chat/useOutboxDrain";
import { useTypingChannel } from "@/features/chat/useTypingChannel";
import { useToast } from "@/context/ToastContext";
import { formatDistanceToNow } from "date-fns";

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
  const setActiveConversationId = useChatStore((s) => s.setActiveConversationId);
  // Draft for THIS conversation. Persisted in localStorage by the store —
  // typing, leaving, and coming back restores the in-progress message.
  const draft = useChatStore((s) => s.draftsByConversation[conversationId] || "");
  const setDraft = useChatStore((s) => s.setDraft);
  const clearDraft = useChatStore((s) => s.clearDraft);
  // Reconnect signal — bumps every time the realtime channel transitions
  // to SUBSCRIBED, including after a drop. Used as a refetch trigger below.
  const lastConnectedAt = useChatStore((s) => s.lastConnectedAt);
  // Presence + typing for the OTHER participant of this conversation.
  const otherUserId = conv?.other_user_id || null;
  const otherOnline = useChatStore((s) =>
    otherUserId ? Boolean(s.onlineUserIds[otherUserId]) : false
  );
  const otherLastSeen = useChatStore((s) =>
    otherUserId ? s.lastSeenByUserId[otherUserId] : undefined
  );
  const typing = useChatStore((s) => s.typingByConversation[conversationId]);
  // Typing channel — opens on mount, closes on unmount. The returned
  // function broadcasts our own "typing" event (throttled internally).
  const sendTyping = useTypingChannel(conversationId, user?.id ?? null);
  // Show "X is typing…" only if the typing event is from the OTHER user
  // (we never want to render our own typing back at us).
  const isOtherTyping = Boolean(
    typing && otherUserId && typing.userId === otherUserId
  );

  // Tell the realtime layer that this conversation is the one currently
  // being viewed. While this is set, incoming messages skip the unread
  // badge increment and auto-mark-as-read on the server. Cleared on
  // unmount + on conversation switch.
  useEffect(() => {
    if (!conversationId) return;
    setActiveConversationId(conversationId);
    return () => setActiveConversationId(null);
  }, [conversationId, setActiveConversationId]);

  const send = useSendMessage();
  const sendingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Thread refetch effect. Fires on:
  //   • Conversation switch (conversationId changes)
  //   • Initial realtime connect (lastConnectedAt: null → number)
  //   • Realtime reconnect (lastConnectedAt: number → newer number)
  // The reconnect case is what catches up any messages that arrived during
  // a dropped websocket — Supabase doesn't replay those events, and on
  // flaky networks they'd otherwise be invisible until the next refresh.
  useEffect(() => {
    if (!user?.id || !conversationId) return;
    fetchThread(conversationId, user.id)
      .then((msgs) => setThread(conversationId, msgs))
      .catch(() => {});
    markConversationRead(conversationId, user.id).catch(() => {});
    clearUnread(conversationId);
  }, [user?.id, conversationId, setThread, clearUnread, lastConnectedAt]);

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
    if (!content || !conversationId) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    // Clear the draft immediately for snappy UX; the message is now in the
    // outbox + store, so even a crash here won't lose it.
    clearDraft(conversationId);
    try {
      await send(conversationId, content);
    } catch {
      toast.danger("Failed to send. Tap the message to retry.");
    } finally {
      sendingRef.current = false;
    }
  }, [draft, conversationId, send, toast, clearDraft]);

  // Tap a failed bubble to retry. Pulls the message back out of the
  // persistent outbox and replays the same code path the auto-drain uses.
  const handleRetry = useCallback(
    async (messageId: string) => {
      if (!user?.id) return;
      try {
        await retryOutboxItem(user.id, messageId);
      } catch {
        toast.danger("Still failing. Check your connection and try again.");
      }
    },
    [user?.id, toast]
  );

  // Compute the header subtitle: typing > online > last seen > nothing.
  // The ordering matches what users expect from WhatsApp/Telegram —
  // "typing…" wins because it's the most actionable signal.
  let headerSubtitle: string | null = null;
  if (isOtherTyping) {
    headerSubtitle = "typing…";
  } else if (otherOnline) {
    headerSubtitle = "online";
  } else if (otherLastSeen) {
    headerSubtitle = `last seen ${formatDistanceToNow(new Date(otherLastSeen), {
      addSuffix: true,
    })}`;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[var(--page-bg)]">
      <Header
        variant="back"
        title={conv?.other_user_name || "Chat"}
        subtitle={headerSubtitle}
        onBack={() => router.push("/messages-v2")}
      />

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain pt-app-header-pill px-4 pb-3"
      >
        {!user && (
          <p className="text-sm text-dark-400 py-12 text-center">Sign in to view this chat.</p>
        )}

        {/* Pre-hydration: show a skeleton for old messages we're loading,
            plus any pending optimistic sends the user just typed. We
            deliberately DON'T render realtime-delivered messages here —
            those would be a partial subset of the real thread and cause
            the "briefly one message, then everything pops in" artifact.
            User's own pending sends are different: they're not partial
            data, they're the user's immediate input and must show
            instantly to feel responsive. */}
        {user && (!thread || !thread.hydrated) && (
          <>
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
            {/* User's own in-flight sends — render them so the user sees
                immediate feedback even while history is still loading. */}
            {messages.filter((m) => m.delivery_status === "pending").length > 0 && (
              <div className="space-y-2 py-3">
                {messages
                  .filter((m) => m.delivery_status === "pending")
                  .map((m) => (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[78%] rounded-2xl px-3.5 py-2 bg-primary-600 text-white">
                        <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <span className="text-[10px] text-white/70">
                            {format(new Date(m.created_at), "HH:mm")}
                          </span>
                          <span className="text-[10px] text-white/70">...</span>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}

        {user && thread?.hydrated && messages.length === 0 && (
          <p className="text-sm text-dark-400 py-12 text-center">
            No messages yet. Say hi 👋
          </p>
        )}

        {user && thread?.hydrated && messages.length > 0 && (
          <div className="space-y-2 py-3">
            {messages.map((m) => {
              const isMine = m.sender_id === user.id;
              const isFailed = m.delivery_status === "failed";
              const bubbleClass = `max-w-[78%] rounded-2xl px-3.5 py-2 ${
                isMine ? "bg-primary-600 text-white" : "bg-white/10 text-dark-100"
              } ${isFailed ? "opacity-70 border border-red-500/60 cursor-pointer" : ""}`;
              return (
                <div
                  key={m.id}
                  className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                >
                  {isFailed && isMine ? (
                    <button
                      type="button"
                      onClick={() => handleRetry(m.id)}
                      className={`${bubbleClass} text-left`}
                      aria-label="Retry sending this message"
                    >
                      {m.is_deleted ? (
                        <p className="text-sm italic opacity-70">Message deleted</p>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {m.content}
                        </p>
                      )}
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <span className="text-[10px] text-white/80">
                          Tap to retry
                        </span>
                        <span className="text-[10px] text-red-300">!</span>
                      </div>
                    </button>
                  ) : (
                    <div className={bubbleClass}>
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
                          <span className="text-[10px] text-white/70">
                            {m.delivery_status === "pending" && "..."}
                            {m.delivery_status === "sent" && "✓"}
                            {m.delivery_status === "seen" && "✓✓"}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
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
            onChange={(e) => {
              setDraft(conversationId, e.target.value);
              // Throttled inside the hook to ~1 broadcast per 1.5s.
              if (e.target.value.length > 0) sendTyping();
            }}
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
            disabled={!draft.trim()}
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
