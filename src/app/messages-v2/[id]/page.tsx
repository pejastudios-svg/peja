"use client";

// v2 chat thread. Reads everything from the chat store. Writes go through
// useSendMessage which handles UUID-based optimistic + DB confirm + retry.
// Realtime updates flow in via the global channel (started by useChatInit
// on the list page or on this page if entered directly).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Send, MessageSquare, ImagePlus, X } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "@/features/chat/store";
import { useChatInit } from "@/features/chat/useChatInit";
import { fetchThread, markConversationRead } from "@/features/chat/api";
import {
  useSendMessage,
  cancelInflightSend,
} from "@/features/chat/useSendMessage";
import { retryOutboxItem } from "@/features/chat/useOutboxDrain";
import { useTypingChannel } from "@/features/chat/useTypingChannel";
import { useToast } from "@/context/ToastContext";
import { validateMediaFile, getVideoDuration } from "@/lib/mediaCompression";
import { MessageText } from "@/components/messages-v2/MessageText";
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
  // Live upload progress per message — keyed by message id, populated
  // by useSendMessage during compression + upload.
  const uploadProgressById = useChatStore((s) => s.uploadProgressById);
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
  // Image picker: hidden file input + a local preview row of selected
  // images. Tapping send fires them through useSendMessage which handles
  // the optimistic add, the outbox, and the upload.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Lightbox state — clicking an image (or video) bubble opens it
  // full-screen. We track the media_type so the modal renders the right
  // element (<img> vs <video controls autoPlay>).
  const [lightbox, setLightbox] = useState<{
    url: string;
    type: "image" | "video";
  } | null>(null);

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

  // Auto-scroll on new message or when the typing bubble appears. Cheap
  // heuristic — always scroll to the bottom when message count changes or
  // the other user starts typing. Phase 7 will refine to honor the user's
  // scroll position if they've scrolled up to read history.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isOtherTyping]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    const filesToSend = pendingFiles;
    // Bail if there's nothing to send. A pure media message with no
    // caption is still valid as long as filesToSend.length > 0.
    if (!conversationId) return;
    if (!content && filesToSend.length === 0) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    // Clear the draft + pending files immediately for snappy UX; the
    // message is now in the outbox + IDB, so even a crash here won't
    // lose it.
    clearDraft(conversationId);
    setPendingFiles([]);
    try {
      await send(conversationId, content, filesToSend);
    } catch {
      toast.danger("Failed to send. Tap the message to retry.");
    } finally {
      sendingRef.current = false;
    }
  }, [draft, pendingFiles, conversationId, send, toast, clearDraft]);

  // Image picker — open the hidden file input. On Capacitor WebView this
  // surfaces the native file picker, which in turn lets the user choose
  // Camera or Gallery. (Android default behavior.)
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesPicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list || list.length === 0) return;
      // Reset so picking the SAME file again still fires onChange. Do
      // this before the async work below so a re-pick during the
      // duration check still triggers a new event.
      const input = e.target;

      // Chat-specific cap: videos can't be longer than 90 s. We check
      // this at pick time (not at upload time) so users get immediate
      // feedback instead of waiting through compression to find out.
      const MAX_VIDEO_SECONDS = 90;

      const accepted: File[] = [];
      const rejected: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        const v = validateMediaFile(file);
        if (!v.valid) {
          rejected.push(v.error || file.name);
          continue;
        }
        if (file.type.startsWith("video/")) {
          try {
            const seconds = await getVideoDuration(file);
            if (seconds > MAX_VIDEO_SECONDS) {
              rejected.push(
                `Video too long. Maximum ${MAX_VIDEO_SECONDS} seconds allowed.`
              );
              continue;
            }
          } catch {
            // If duration can't be read, fall through and let the
            // upload attempt — the lib's own duration check is a
            // backstop.
          }
        }
        accepted.push(file);
      }
      if (rejected.length > 0) {
        toast.danger(
          rejected.length === 1
            ? rejected[0]
            : `${rejected.length} files rejected: ${rejected[0]}`
        );
      }
      if (accepted.length > 0) {
        setPendingFiles((prev) => [...prev, ...accepted]);
      }
      input.value = "";
    },
    [toast]
  );

  const handleRemovePending = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

  // Tap the X next to the progress ring to cancel an in-flight upload.
  // Aborts the Cloudinary XHR (Supabase Storage uploads keep going in
  // the background — SDK doesn't expose a signal — but the message
  // bubble disappears either way).
  const handleCancel = useCallback(
    (messageId: string) => {
      cancelInflightSend(messageId, {
        userId: user?.id ?? undefined,
        conversationId,
      });
    },
    [user?.id, conversationId]
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
              const isPending = m.delivery_status === "pending";
              const hasMedia = !!(m.media && m.media.length > 0);
              // Media bubble: no padding around the image — the image
              // fills the bubble corner-to-corner for the gallery feel.
              // Text bubble: standard padding.
              const baseColor = isMine
                ? "bg-primary-600 text-white"
                : "bg-white/10 text-dark-100";
              const bubbleClass = `max-w-[78%] rounded-2xl ${
                hasMedia ? "p-1" : "px-3.5 py-2"
              } ${baseColor} ${
                isFailed ? "opacity-70 border border-red-500/60 cursor-pointer" : ""
              }`;
              const bubbleInner = (
                <>
                  {hasMedia && (
                    <div className="space-y-1">
                      {m.media!.map((media) => {
                        if (
                          media.media_type !== "image" &&
                          media.media_type !== "video"
                        ) {
                          return null;
                        }
                        const isVideo = media.media_type === "video";
                        const ratio =
                          media.width && media.height
                            ? `${media.width} / ${media.height}`
                            : isVideo
                              ? "16 / 9"
                              : "4 / 3";
                        const progress = uploadProgressById[m.id];
                        return (
                          <div
                            key={media.id}
                            className="relative rounded-xl overflow-hidden bg-black/30 w-[260px] max-w-full"
                            style={{ aspectRatio: ratio }}
                          >
                            {isVideo ? (
                              // Native video controls handle play /
                              // pause / scrub / fullscreen — no big
                              // play overlay, no lightbox-on-click. A
                              // tap lands on the browser's built-in
                              // play button. `poster` uses Cloudinary's
                              // first-frame JPEG when available, so the
                              // tile shows the right frame instantly
                              // without forcing the browser to fetch
                              // the entire MP4 metadata.
                              <video
                                src={media.url}
                                poster={media.thumbnail_url || undefined}
                                preload="metadata"
                                playsInline
                                controls={!isPending && !isFailed}
                                className={`block w-full h-full object-cover bg-black ${
                                  isPending ? "opacity-70" : ""
                                }`}
                              />
                            ) : (
                              <img
                                src={media.url}
                                alt=""
                                className={`block w-full h-full object-cover ${
                                  isPending ? "opacity-70" : ""
                                }`}
                                onClick={(e) => {
                                  if (isFailed) return;
                                  e.stopPropagation();
                                  setLightbox({
                                    url: media.url,
                                    type: "image",
                                  });
                                }}
                              />
                            )}
                            {/* Circular progress ring while uploading.
                                The ring fills from the live progress
                                store entry (compression + upload
                                combined). On retry, the ring resumes
                                from where it left off. The X button
                                inside aborts the upload mid-flight. */}
                            {isPending && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <UploadRing
                                  fraction={progress?.fraction ?? 0}
                                  label={progress?.label}
                                  onCancel={() => handleCancel(m.id)}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {m.is_deleted ? (
                    <p
                      className={`text-sm italic opacity-70 ${
                        hasMedia ? "px-2.5 pt-1.5" : ""
                      }`}
                    >
                      Message deleted
                    </p>
                  ) : (
                    m.content && (
                      <p
                        className={`text-sm whitespace-pre-wrap break-words ${
                          hasMedia ? "px-2.5 pt-1.5" : ""
                        }`}
                      >
                        <MessageText
                          text={m.content}
                          linkClass={
                            isMine ? "text-white/90" : "text-primary-300"
                          }
                        />
                      </p>
                    )
                  )}
                  <div
                    className={`flex items-center justify-end gap-1 mt-0.5 ${
                      hasMedia ? "px-2.5 pb-1" : ""
                    }`}
                  >
                    {isFailed && isMine ? (
                      <>
                        <span className="text-[10px] text-white/80">Tap to retry</span>
                        <span className="text-[10px] text-red-300">!</span>
                      </>
                    ) : (
                      <>
                        <span
                          className={`text-[10px] ${
                            isMine ? "text-white/70" : "text-dark-500"
                          }`}
                        >
                          {format(new Date(m.created_at), "HH:mm")}
                        </span>
                        {isMine && (
                          <span className="text-[10px] text-white/70">
                            {isPending && "..."}
                            {m.delivery_status === "sent" && "✓"}
                            {m.delivery_status === "seen" && "✓✓"}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </>
              );
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
                      {bubbleInner}
                    </button>
                  ) : (
                    <div className={bubbleClass}>{bubbleInner}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* In-thread typing indicator. Renders as a small left-aligned
            bubble where an incoming message would appear, with a pulsing
            chat-bubble icon. The "typing…" text in the header stays put;
            this is the visual companion. When voice notes ship in Phase 3
            this same slot will host a pulsing mic icon for recording. */}
        {user && isOtherTyping && (
          <div className="flex justify-start pb-3 pt-1">
            <div className="rounded-2xl bg-white/10 text-dark-100 px-3 py-2 inline-flex items-center">
              <MessageSquare
                className="w-4 h-4 text-primary-300 animate-pulse"
                strokeWidth={2.25}
                aria-label="Typing"
              />
            </div>
          </div>
        )}
      </main>

      <div
        className="border-t border-white/5 bg-[var(--page-bg)] px-3 py-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        {/* Pending-attachments preview row. Renders thumbnails of the
            images the user has picked but hasn't yet sent. Each has a
            small X to remove before send. */}
        {pendingFiles.length > 0 && (
          <div className="max-w-2xl mx-auto flex gap-2 overflow-x-auto pb-2">
            {pendingFiles.map((file, i) => (
              <PendingThumb
                key={`${file.name}-${i}`}
                file={file}
                onRemove={() => handleRemovePending(i)}
              />
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 max-w-2xl mx-auto">
          <button
            type="button"
            onClick={handleAttachClick}
            className="shrink-0 w-10 h-10 rounded-full bg-white/5 border border-white/10 text-dark-200 flex items-center justify-center hover:bg-white/10 transition-colors"
            aria-label="Attach photo"
          >
            <ImagePlus className="w-5 h-5" />
          </button>
          {/* Hidden file input — accepts images and videos in Phase 3b.
              Multiple selection so users can send a few attachments at
              once (album-style). Voice notes + files come in 3c / 3d. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handleFilesPicked}
            className="hidden"
          />
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
            disabled={!draft.trim() && pendingFiles.length === 0}
            className="shrink-0 w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Lightbox — fullscreen overlay when a media bubble is tapped.
          Click anywhere (or the X) to close. Renders <img> for image
          and <video controls autoPlay> for video. */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(null);
            }}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          {lightbox.type === "video" ? (
            <video
              src={lightbox.url}
              controls
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full"
            />
          ) : (
            <img
              src={lightbox.url}
              alt=""
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain"
            />
          )}
        </div>
      )}
    </div>
  );
}

// Circular progress ring drawn on top of a pending media bubble.
// Renders as an SVG arc whose stroke-dashoffset is driven by the
// `fraction` (0..1) prop. Centre shows the integer percentage so users
// can see real movement vs. a generic spinner. Optional label (e.g.
// "Uploading video 35%") appears just below for context.
function UploadRing({
  fraction,
  label,
  onCancel,
}: {
  fraction: number;
  label?: string;
  onCancel?: () => void;
}) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const pct = Math.round(clamped * 100);
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <svg
          width={56}
          height={56}
          viewBox="0 0 56 56"
          className="-rotate-90"
        >
          <circle
            cx={28}
            cy={28}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={3}
          />
          <circle
            cx={28}
            cy={28}
            r={radius}
            fill="none"
            stroke="white"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.2s ease" }}
          />
        </svg>
        {/* Inside the ring: X tap target if a cancel handler is wired,
            otherwise the percentage. Tap target wins because it's the
            actionable element — the percentage stays readable on the
            label chip below. */}
        <div className="absolute inset-0 flex items-center justify-center">
          {onCancel ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="w-9 h-9 rounded-full bg-black/45 hover:bg-black/60 flex items-center justify-center transition-colors"
              aria-label="Cancel upload"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          ) : (
            <span className="text-[11px] font-semibold text-white">{pct}%</span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-white/90 bg-black/40 px-1.5 py-0.5 rounded">
        {label ? label : `${pct}%`}
      </span>
    </div>
  );
}

// Thumbnail for a File in the to-be-sent row. Builds + revokes its own
// blob URL so the parent doesn't have to manage memory for previews.
// For videos, renders a muted `<video preload="metadata">` so the
// browser pulls the first frame on its own — looks like a real
// thumbnail without any extra canvas/extraction code.
function PendingThumb({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const isVideo = file.type.startsWith("video/");
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="relative shrink-0">
      <div className="w-16 h-16 rounded-xl overflow-hidden bg-white/5 border border-white/10">
        {url &&
          (isVideo ? (
            <video
              src={url}
              muted
              playsInline
              preload="metadata"
              className="w-full h-full object-cover"
            />
          ) : (
            <img src={url} alt="" className="w-full h-full object-cover" />
          ))}
      </div>
      {isVideo && (
        <span
          className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] font-semibold px-1 rounded"
          aria-hidden
        >
          ▶
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/80 border border-white/20 text-white flex items-center justify-center"
        aria-label="Remove"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
