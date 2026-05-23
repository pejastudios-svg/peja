"use client";

// Chat thread. Reads everything from the chat store. Writes go through
// useSendMessage which handles UUID-based optimistic + DB confirm + retry.
// Realtime updates flow in via the global channel — useChatInit is
// mounted at the root by <ChatBootstrap />, so this page just reads.

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  Send,
  MessageSquare,
  Paperclip,
  X,
  Mic,
  FileText,
  Ban,
  ChevronDown,
  Copy as CopyIcon,
  Trash2,
  Reply as ReplyIcon,
  Pencil,
  Check,
  Forward as ForwardIcon,
  Flag as FlagIcon,
  Pin as PinIcon,
  PinOff,
  User,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "@/features/chat/store";
import {
  fetchThread,
  markConversationRead,
  markChatNotificationsRead,
} from "@/features/chat/api";
import {
  getCachedThread,
  saveCachedThread,
  deleteCachedThread,
} from "@/features/chat/threadCache";
import {
  useSendMessage,
  cancelInflightSend,
} from "@/features/chat/useSendMessage";
import { retryOutboxItem } from "@/features/chat/useOutboxDrain";
import { useTypingChannel } from "@/features/chat/useTypingChannel";
import { useToast } from "@/context/ToastContext";
import { validateMediaFile, getVideoDuration } from "@/lib/mediaCompression";
import { MessageText } from "@/components/messages-v2/MessageText";
import {
  IncidentLinkPreview,
  extractIncidentPostId,
} from "@/components/messages-v2/IncidentLinkPreview";
import { VoiceRecorderBar } from "@/components/messages-v2/VoiceRecorderBar";
import { AudioBubble } from "@/components/messages-v2/AudioBubble";
import { DocumentBubble } from "@/components/messages-v2/DocumentBubble";
import { UploadRing } from "@/components/messages-v2/UploadRing";
import { DocumentViewer } from "@/components/messages-v2/DocumentViewer";
import { MediaGrid, type MediaGridItem } from "@/components/messages-v2/MediaGrid";
import { MediaCarousel, type CarouselItem } from "@/components/messages-v2/MediaCarousel";
import { AvatarPreview } from "@/components/messages-v2/AvatarPreview";
import { ChatInfoSheet } from "@/components/messages-v2/ChatInfoSheet";
import { AddMemberSheet } from "@/components/messages-v2/AddMemberSheet";
import { supabase } from "@/lib/supabase";
import { KebabMenu } from "@/components/messages-v2/KebabMenu";
import {
  setBlocked,
  clearChatForUser,
  deleteChatForUser,
  forwardMessage as apiForwardMessage,
  submitUserReport,
  fetchGroupParticipants,
  renameGroup as apiRenameGroup,
  setGroupAvatar as apiSetGroupAvatar,
  uploadGroupAvatar as apiUploadGroupAvatar,
  addGroupMember as apiAddGroupMember,
  removeGroupMember as apiRemoveGroupMember,
  leaveGroup as apiLeaveGroup,
  deleteGroup as apiDeleteGroup,
  setNotificationMode as apiSetNotificationMode,
  setMessagePinned as apiSetMessagePinned,
  type UserReportReason,
  type NotificationMode,
} from "@/features/chat/api";
import type { GroupParticipant } from "@/features/chat/types";
import { dispatchOrQueue, uuid as actionUuid } from "@/features/chat/actionQueue";
import { MessageActionMenu, type MenuAction } from "@/components/messages-v2/MessageActionMenu";
import { ReplyPreview } from "@/components/messages-v2/ReplyPreview";
import { QuotedReplyBlock } from "@/components/messages-v2/QuotedReplyBlock";
import { ReactionBadges } from "@/components/messages-v2/ReactionBadges";
import { ForwardSheet } from "@/components/messages-v2/ForwardSheet";
import { ReportUserModal } from "@/components/messages-v2/ReportUserModal";
import { SearchInChatSheet } from "@/components/messages-v2/SearchInChatSheet";
import {
  DateDivider,
  UnreadDivider,
  dateBucket,
} from "@/components/messages-v2/ThreadDividers";
import { notifyDMReaction, notifyDMBlocked } from "@/lib/notifications";
import {
  setViewingConversation,
  isUserViewingConversation,
} from "@/features/chat/presence";
import { useLongPress } from "@/features/chat/useLongPress";
import { useSwipeToReply } from "@/features/chat/useSwipeToReply";
import type { ChatMessage, MessageReaction, ReplyTarget } from "@/features/chat/types";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
import { formatDistanceToNow } from "date-fns";

export default function ThreadV2Page() {
  const params = useParams();
  const searchParams = useSearchParams();
  // ?focus=<messageId> — set by cross-chat search results.
  // Cleared after we successfully scroll so a refresh of the
  // chat doesn't re-fire the focus jump.
  const focusMessageId = searchParams?.get("focus") ?? null;
  const conversationId = String(params?.id || "");
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

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
  // Typing channel — opens on mount, closes on unmount. Both
  // sendTyping and sendRecording are throttled to ~1 broadcast / 1.5 s
  // by the hook.
  const { sendTyping, sendRecording } = useTypingChannel(
    conversationId,
    user?.id ?? null
  );
  // What the OTHER user is doing right now (if anything). Drives
  // the header subtitle + in-thread bubble icon.
  const otherActivity =
    typing && otherUserId && typing.userId === otherUserId ? typing.kind : null;
  const isOtherTyping = otherActivity === "typing";
  const isOtherRecording = otherActivity === "recording";

  // Tell the realtime layer that this conversation is the one currently
  // being viewed. While this is set, incoming messages skip the unread
  // badge increment and auto-mark-as-read on the server. Cleared on
  // unmount + on conversation switch.
  useEffect(() => {
    if (!conversationId) return;
    setActiveConversationId(conversationId);
    // Mirror the active-conversation id onto window so the global
    // InAppNotificationToasts listener can suppress its banner when
    // a DM or group message arrives for the chat the user is staring
    // at. Same convention v1 uses (see MessageCacheContext); reading
    // a single window key keeps the toast layer decoupled from the
    // store routing of either chat implementation.
    if (typeof window !== "undefined") {
      (window as any).__pejaActiveConversationId = conversationId;
    }
    // Announce to peers via presence that we're viewing this thread —
    // their useSendMessage notification gate reads this and skips
    // the push for messages into the chat we're staring at right now.
    setViewingConversation(conversationId).catch(() => {});
    return () => {
      setActiveConversationId(null);
      if (typeof window !== "undefined") {
        (window as any).__pejaActiveConversationId = null;
      }
      setViewingConversation(null).catch(() => {});
    };
  }, [conversationId, setActiveConversationId]);

  const send = useSendMessage();
  const sendingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Image picker: hidden file input + a local preview row of selected
  // images. Tapping send fires them through useSendMessage which handles
  // the optimistic add, the outbox, and the upload.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Mirrors pendingFiles into a ref so the file-picker callback can
  // dedupe against the current set rather than a stale closure value
  // (the closure was empty after the first pick, which let the second
  // pick re-add the same file).
  const pendingFilesRef = useRef<File[]>([]);
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);
  // Lightbox state — tapping any image / video tile opens a
  // fullscreen carousel. We carry the WHOLE bundle (image+video items
  // from the same message) and the tapped index, so swiping inside
  // the carousel walks through the rest of the album.
  const [lightbox, setLightbox] = useState<{
    items: CarouselItem[];
    index: number;
  } | null>(null);
  // Document viewer state — clicking a non-image/video media bubble
  // opens the in-app iframe modal instead of leaving the chat.
  const [docViewer, setDocViewer] = useState<{
    url: string;
    fileName: string;
  } | null>(null);
  // Chat-info overlay (tap the name) + avatar preview (tap the avatar).
  // The kebab opens the same chat-info sheet.
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [showAvatarPreview, setShowAvatarPreview] = useState(false);
  // Group participants — populated only when the conversation is a
  // group. Drives the sender-name labels above each incoming bubble
  // plus the Members list inside the chat-info sheet.
  const [groupParticipants, setGroupParticipants] = useState<
    GroupParticipant[] | null
  >(null);
  const groupParticipantsById = useMemo(() => {
    if (!groupParticipants) return null;
    const m: Record<string, GroupParticipant> = {};
    for (const p of groupParticipants) m[p.user_id] = p;
    return m;
  }, [groupParticipants]);
  useEffect(() => {
    if (!conversationId) return;
    if (!conv?.is_group) {
      setGroupParticipants(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchGroupParticipants(conversationId)
        .then((rows) => {
          if (!cancelled) setGroupParticipants(rows);
        })
        .catch((err) => {
          console.error("[chat-v2] participants fetch failed", err);
          if (!cancelled) setGroupParticipants([]);
        });
    };
    load();
    // Live updates on membership change. When peja_group_add_member
    // or peja_group_remove_member fires (or anyone leaves), the
    // INSERT / DELETE on conversation_participants flows through
    // Supabase realtime — we refetch the participants snapshot.
    // The DB-level system-message trigger separately inserts a
    // "X joined / X left" row, which the existing message realtime
    // sub already picks up to add the chip.
    const channel = supabase
      .channel(`conv-participants-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_participants",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => load()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId, conv?.is_group, conv?.member_count]);
  // Track the previous blocked_by_other value so we can fire a one-time
  // toast the moment the flag flips on. Without this the banner just
  // appears silently — the user might not notice until they try to
  // send. We deliberately don't toast on flip-off because unblock
  // restores normal state (the composer comes back, that's the signal).
  const prevBlockedByOther = useRef<boolean | null>(null);
  useEffect(() => {
    if (!conv) return;
    const now = !!conv.blocked_by_other;
    if (prevBlockedByOther.current === true && !now) {
      // unblock — no toast; restored composer is the signal
    } else if (prevBlockedByOther.current === false && now) {
      toast.warning(
        `${conv.other_user_name || "This user"} has blocked you.`
      );
    }
    prevBlockedByOther.current = now;
  }, [conv, toast]);
  // Confirmation modal for destructive actions (block, clear chat,
  // delete chat). We render a small inline confirm rather than reusing
  // window.confirm so the dialog is consistent with the rest of the
  // dark/light theme and works inside the Capacitor WebView.
  const [pendingAction, setPendingAction] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    danger: boolean;
    run: () => Promise<void> | void;
  } | null>(null);
  // Per-message action menu (long-press / right-click / hover-chevron
  // trigger). Holds the target message and the pixel anchor for the
  // floating menu — MessageActionMenu does its own viewport clamping.
  const [activeMenu, setActiveMenu] = useState<{
    message: ChatMessage;
    anchor: { x: number; y: number };
  } | null>(null);
  // Reply context — when set, the composer shows a preview row above
  // the textarea and the next send call passes reply_to_id.
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  // Edit context — when set, the textarea drives editMessage instead
  // of send. We snapshot the draft we'd been typing so cancelling
  // restores it.
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const savedDraftRef = useRef<string>("");
  // Forward sheet — when set, opens the recipient picker for the
  // chosen source message.
  const [forwardSource, setForwardSource] = useState<ChatMessage | null>(null);
  // Report-user modal — opened from chat info sheet or kebab.
  const [reportOpen, setReportOpen] = useState(false);
  // When set, the report modal is reporting THIS specific message
  // (instead of the conversation's other user). Used in groups
  // where one member reports another's bubble. The handler reads
  // this on submit to attach message_id + the sender as
  // reported_id.
  const [reportingMessage, setReportingMessage] = useState<ChatMessage | null>(
    null
  );
  // In-chat search overlay.
  const [searchOpen, setSearchOpen] = useState(false);
  // Pagination state for "load older on scroll up". hasMoreRef goes
  // false the first time fetchThread (or the older-page fetch)
  // returns FEWER than the page size — that's our signal that we've
  // hit the start of the conversation.
  const hasMoreOlderRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Captured BEFORE a load-older fetch so we can restore scroll
  // position after the prepended page expands scrollHeight. Without
  // this, prepending 50 messages would jolt the viewport upward.
  const olderScrollAnchorRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  // Closing animation state. When the user taps Back, we flip this
  // to true so the page applies `peja-slide-out-to-right` and then
  // call router.push once the keyframe lands (220ms — matches the
  // animation duration). Mirrors the ChatInfoSheet close pattern.
  const [closing, setClosing] = useState(false);
  const handleBack = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => router.push("/messages"), 220);
  }, [closing, router]);
  // Snapshot the unread baseline at mount. The thread page uses this
  // to decide WHERE to draw the "Unread messages" divider — locked
  // to the value we had when the user opened the chat so the divider
  // stays put even as we mark the conversation read in the
  // background. `null` (no prior read) → divider appears above the
  // very first incoming message.
  const initialReadAtRef = useRef<string | null | undefined>(undefined);
  if (initialReadAtRef.current === undefined && conv) {
    initialReadAtRef.current = conv.my_last_read_at ?? null;
  }
  // Transient highlight target — set briefly when the user taps a
  // quoted-reply block, we scroll the parent into view and flash a
  // ring + tint on the bubble. Cleared 1.4s later so re-tapping the
  // same parent re-fires the animation.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const scrollToMessage = useCallback((messageId: string) => {
    const el = scrollRef.current?.querySelector(
      `[data-message-id="${CSS.escape(messageId)}"]`
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    setHighlightedMessageId(null);
    // Re-set on the next frame so the animation always re-fires, even
    // when tapping the same parent twice in a row.
    requestAnimationFrame(() => {
      setHighlightedMessageId(messageId);
      highlightTimerRef.current = window.setTimeout(() => {
        setHighlightedMessageId(null);
      }, 1400);
    });
  }, []);
  // Voice-record mode: when ON, the input bar swaps the textarea +
  // mic + send for the recording UI. Set by pressing the mic button.
  const [recording, setRecording] = useState(false);

  // Thread refetch effect. Fires on:
  //   • Conversation switch (conversationId changes)
  //   • Initial realtime connect (lastConnectedAt: null → number)
  //   • Realtime reconnect (lastConnectedAt: number → newer number)
  // The reconnect case is what catches up any messages that arrived during
  // a dropped websocket — Supabase doesn't replay those events, and on
  // flaky networks they'd otherwise be invisible until the next refresh.
  useEffect(() => {
    if (!user?.id || !conversationId) return;
    // Reset pagination cursor for a fresh thread load — switching
    // conversations means we have a new history to walk.
    hasMoreOlderRef.current = true;

    // Warm-start: restore the last-known thread snapshot from IDB
    // BEFORE fetchThread resolves so the user sees content immediately
    // instead of an empty skeleton. We only restore if the in-memory
    // thread is empty — switching back to a chat that's still in the
    // store doesn't need a redundant restore.
    if (!useChatStore.getState().threadsByConversation[conversationId]?.hydrated) {
      void getCachedThread(user.id, conversationId).then((cached) => {
        if (!cached || cached.length === 0) return;
        // Bail if fetchThread already populated the store while we
        // were waiting on IDB — fresh data wins over the snapshot.
        const cur = useChatStore.getState().threadsByConversation[conversationId];
        if (cur?.hydrated) return;
        setThread(conversationId, cached);
      });
    }

    fetchThread(conversationId, user.id, 50)
      .then((msgs) => {
        setThread(conversationId, msgs);
        // Overwrite the snapshot with the fresh page so the next
        // open of this chat warms up to the latest state. Fire and
        // forget — caching is a perf optimisation, not correctness.
        void saveCachedThread(user.id!, conversationId, msgs);
        // A short first page means we've already loaded the entire
        // conversation — no point trying to paginate older.
        if (msgs.length < 50) hasMoreOlderRef.current = false;
      })
      .catch(() => {});
    markConversationRead(conversationId, user.id)
      .then((readAt) => {
        // Keep the local summary in sync so a re-open of THIS chat
        // computes the unread-divider cutoff against the right
        // timestamp. Without this patch the store keeps the stale
        // value from the previous fetchConversationList, which made
        // every chat look like it had unread messages on re-entry.
        useChatStore
          .getState()
          .patchConversation(conversationId, { my_last_read_at: readAt });
      })
      .catch(() => {});
    // Also mark any chat-related notifications as read so the
    // notifications page doesn't sit on a stale unread badge after
    // the user has clearly seen the chat.
    markChatNotificationsRead(conversationId, user.id).catch(() => {});
    // Broadcast a refresh so the bell badge in the header updates
    // without waiting for its 30s poll.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("peja-notifications-changed"));
    }
    clearUnread(conversationId);
  }, [user?.id, conversationId, setThread, clearUnread, lastConnectedAt]);

  const messages = useMemo(() => thread?.messages || [], [thread?.messages]);

  // === Scroll-anchoring logic ===
  // Rule: only auto-scroll to the latest message when the user is
  // ALREADY anchored to the bottom of the thread. If they've scrolled
  // up to read history, a new message or typing pulse must NOT yank
  // them back down. Instead we surface a floating "new messages"
  // avatar badge (rendered further down) — tap it to jump down.
  //
  // "At bottom" is a fuzzy concept: with kinetic scrolling and
  // sub-pixel rounding the value rarely lands exactly at the floor,
  // so we use a 60px tolerance.
  const AT_BOTTOM_PX = 60;
  const isAtBottomRef = useRef(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const lastSeenMessageCountRef = useRef(messages.length);

  // Fetches the next page of OLDER messages (created_at < oldest
  // currently in the store) and prepends them. Trips a layout-effect
  // that re-anchors the viewport so the user's position relative to
  // their last-visible message doesn't jump.
  const loadOlderMessages = useCallback(async () => {
    if (!user?.id || !conversationId) return;
    if (loadingOlderRef.current || !hasMoreOlderRef.current) return;
    const oldest = messages[0]?.created_at;
    if (!oldest) return;
    const el = scrollRef.current;
    if (el) {
      olderScrollAnchorRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      };
    }
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const older = await fetchThread(conversationId, user.id, 50, oldest);
      if (older.length === 0) {
        hasMoreOlderRef.current = false;
      } else {
        useChatStore.getState().prependOlderMessages(conversationId, older);
        // Short page → no more history beyond this one.
        if (older.length < 50) hasMoreOlderRef.current = false;
      }
    } catch {
      // Swallow — the badge stays in place, user can scroll again
      // later to retry.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [user?.id, conversationId, messages]);

  const handleThreadScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    const wasAtBottom = isAtBottomRef.current;
    const nowAtBottom = distance <= AT_BOTTOM_PX;
    isAtBottomRef.current = nowAtBottom;
    if (!wasAtBottom && nowAtBottom) {
      // User scrolled all the way down → catch up the seen counter,
      // hide the badge.
      lastSeenMessageCountRef.current = messages.length;
      setUnseenCount(0);
    }
    // Trigger a backwards page when the user gets near the top.
    // 200 px gives the fetch enough time to land before the user
    // bumps the actual scroll boundary.
    if (
      el.scrollTop < 200 &&
      hasMoreOlderRef.current &&
      !loadingOlderRef.current &&
      messages.length > 0
    ) {
      void loadOlderMessages();
    }
  }, [messages.length, loadOlderMessages]);

  // ?focus=<id> handler. When the chat opens with a focus target —
  // typically from cross-chat search — walk pagination backward
  // until the message is in the rendered window, scroll to it +
  // highlight-flash, and clear the URL param.
  //
  // Hard-cap the backward walk so a malformed id (or a message that
  // got delete-for-everyone'd between the search and the click)
  // doesn't recursively page through the entire history. 10 pages =
  // 500 messages, which is plenty for normal use.
  const focusAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMessageId) return;
    if (!user?.id || !conversationId) return;
    if (!thread?.hydrated) return;
    if (focusAttemptedRef.current === focusMessageId) return;
    focusAttemptedRef.current = focusMessageId;

    let cancelled = false;
    (async () => {
      const MAX_PAGES = 10;
      for (let i = 0; i < MAX_PAGES; i++) {
        if (cancelled) return;
        const inStore = (
          useChatStore.getState().threadsByConversation[conversationId]
            ?.messages || []
        ).some((m) => m.id === focusMessageId);
        if (inStore) break;
        if (!hasMoreOlderRef.current) break;
        await loadOlderMessages();
      }
      if (cancelled) return;
      scrollToMessage(focusMessageId);
      // Clear the param so refreshing this page doesn't re-fire the
      // jump on every load. We replace rather than push so the back
      // button still returns to wherever the user came from.
      const url = new URL(window.location.href);
      url.searchParams.delete("focus");
      router.replace(url.pathname + (url.search || ""));
    })();

    return () => {
      cancelled = true;
    };
  }, [
    focusMessageId,
    user?.id,
    conversationId,
    thread?.hydrated,
    loadOlderMessages,
    scrollToMessage,
    router,
  ]);

  // After older messages land in the store, restore the user's scroll
  // position relative to what they were viewing. The new page expands
  // scrollHeight by some amount; we offset scrollTop by the same so
  // the previously-visible message stays under the user's eye.
  useLayoutEffect(() => {
    const anchor = olderScrollAnchorRef.current;
    if (!anchor) return;
    const el = scrollRef.current;
    if (!el) return;
    const delta = el.scrollHeight - anchor.scrollHeight;
    if (delta > 0) {
      el.scrollTop = anchor.scrollTop + delta;
    }
    olderScrollAnchorRef.current = null;
  }, [messages.length]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    isAtBottomRef.current = true;
    lastSeenMessageCountRef.current = messages.length;
    setUnseenCount(0);
  }, [messages.length]);

  // On first hydration of the thread, snap to the bottom without
  // animation so the user lands at the latest message.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (!thread?.hydrated || messages.length === 0) return;
    didInitialScrollRef.current = true;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      isAtBottomRef.current = true;
      lastSeenMessageCountRef.current = messages.length;
    }
  }, [thread?.hydrated, messages.length]);

  // React to message-count growth. Two cases:
  //   • User is at the bottom → auto-scroll (matches the old behaviour
  //     for the common case).
  //   • User is scrolled up → DON'T scroll; bump the unseen counter
  //     by the number of new messages that arrived in THIS tick.
  // Message DELETIONS (count goes down) never scroll.
  //
  // Critical: always advance lastSeenMessageCountRef.current to the
  // new count at the end. The previous version only advanced it when
  // the user was at the bottom — so for a user scrolled up, every
  // subsequent run computed diff = current - original_baseline,
  // producing triangular numbers (1, 3, 6, 10…) instead of (1, 2,
  // 3, 4…).
  useEffect(() => {
    if (!didInitialScrollRef.current) return;
    const prev = lastSeenMessageCountRef.current;
    const next = messages.length;
    if (next > prev) {
      const diff = next - prev;
      if (isAtBottomRef.current) {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      } else {
        setUnseenCount((c) => c + diff);
      }
    }
    lastSeenMessageCountRef.current = next;
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    const filesToSend = pendingFiles;
    // Bail if there's nothing to send. A pure media message with no
    // caption is still valid as long as filesToSend.length > 0.
    if (!conversationId) return;
    if (!content && filesToSend.length === 0) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    // Clear the draft + pending files immediately for snappy UX.
    clearDraft(conversationId);
    setPendingFiles([]);
    // Snapshot the reply target then clear it before any awaits — we
    // want the next send to carry it but a follow-up send to start
    // clean. Clearing optimistically also dismisses the preview row
    // before the network round-trip.
    const replySnapshot = replyingTo;
    setReplyingTo(null);

    try {
      if (filesToSend.length === 0) {
        // Text-only message.
        await send(conversationId, content, [], replySnapshot);
        return;
      }
      // Split picked files by routing:
      //   • Images + videos → bundled into ONE message so they render
      //     as a WhatsApp-style album (grid + carousel viewer).
      //   • Documents → one message each, so each gets its own
      //     progress ring and arrives independently as it finishes
      //     uploading (the asymmetric-progress UX the user asked for).
      const visualMedia: File[] = [];
      const documents: File[] = [];
      for (const f of filesToSend) {
        if (f.type.startsWith("image/") || f.type.startsWith("video/")) {
          visualMedia.push(f);
        } else {
          documents.push(f);
        }
      }
      // Caption attaches to the visual-media bundle if there is one,
      // otherwise to the first document. Subsequent docs go captionless.
      // The reply context attaches to the FIRST send only (the message
      // that carries the caption). Subsequent split sends are plain.
      let captionConsumed = false;
      let replyConsumed = false;
      const useReply = () => {
        if (replyConsumed) return null;
        replyConsumed = true;
        return replySnapshot;
      };
      if (visualMedia.length > 0) {
        void send(conversationId, content, visualMedia, useReply()).catch(
          () => {
            toast.danger("Failed to send. Tap the message to retry.");
          }
        );
        captionConsumed = true;
      }
      for (let i = 0; i < documents.length; i++) {
        const caption = !captionConsumed && i === 0 ? content : "";
        if (!captionConsumed && i === 0) captionConsumed = true;
        void send(
          conversationId,
          caption,
          [documents[i]],
          i === 0 ? useReply() : null
        ).catch(() => {
          toast.danger("Failed to send. Tap the message to retry.");
        });
      }
    } catch {
      toast.danger("Failed to send. Tap the message to retry.");
    } finally {
      sendingRef.current = false;
    }
  }, [
    draft,
    pendingFiles,
    conversationId,
    send,
    toast,
    clearDraft,
    replyingTo,
  ]);

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

      // Dedupe against already-pending files — a user re-picking the
      // same file shouldn't end up with two copies queued. Reading
      // from the ref (not the captured `pendingFiles`) is critical:
      // useCallback's closure keeps the original empty list, which
      // would let dupes through on every subsequent pick.
      const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
      const existingKeys = new Set(pendingFilesRef.current.map(fileKey));

      const accepted: File[] = [];
      const rejected: string[] = [];
      let dupedCount = 0;
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        if (existingKeys.has(fileKey(file))) {
          dupedCount += 1;
          continue;
        }
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
        existingKeys.add(fileKey(file));
        accepted.push(file);
      }
      if (rejected.length > 0) {
        toast.danger(
          rejected.length === 1
            ? rejected[0]
            : `${rejected.length} files rejected: ${rejected[0]}`
        );
      }
      if (dupedCount > 0 && accepted.length === 0) {
        toast.info(
          dupedCount === 1 ? "Already attached." : `${dupedCount} files already attached.`
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

  // === Chat-info / kebab action handlers ===
  // Each handler patches the store immediately (so the UI reflects the
  // change without waiting for the network) and persists in the
  // background. Destructive actions surface a confirm modal first.

  const handleToggleMute = useCallback(async () => {
    if (!user?.id || !conv) return;
    // For groups we drive notification_mode (the 3-way 'all' /
    // 'mentions' / 'muted' choice). Mute and Mentions-only are
    // siblings, not stacked: tapping Mute when mode is 'mentions'
    // goes to 'muted', and tapping Mute when already 'muted'
    // returns to 'all'. The store patch + RPC call is inlined
    // here so this handler doesn't depend on the later-declared
    // handleSetNotificationMode.
    //
    // Both DM and group paths now go through setNotificationMode.
    // The legacy setMuted (which only wrote is_muted) doesn't suppress
    // notifications anymore because peja_notify_dm checks
    // notification_mode first, and that column defaults to 'all' NOT
    // NULL — so the legacy fallback `(mode is null and is_muted)` can
    // never fire on a post-20260606 schema. Toggling is_muted alone
    // would visually update the UI but leave the server-side check
    // unmoved, which is the exact symptom that was reported.
    const current = (conv as { notification_mode?: NotificationMode })
      .notification_mode || "all";
    const nextMode: NotificationMode = current === "muted" ? "all" : "muted";
    const store = useChatStore.getState();
    store.patchConversation(conv.id, {
      notification_mode: nextMode,
      is_muted: nextMode !== "all",
    });
    try {
      await apiSetNotificationMode(conv.id, nextMode);
      toast.info(
        nextMode === "muted" ? "Notifications muted" : "Notifications on"
      );
    } catch {
      store.patchConversation(conv.id, {
        notification_mode: current,
        is_muted: current !== "all",
      });
      toast.danger("Couldn't update notifications");
    }
  }, [user?.id, conv, toast]);

  const handleToggleBlock = useCallback(() => {
    if (!user?.id || !conv) return;
    const next = !conv.is_blocked;
    const otherId = conv.other_user_id;
    if (!next) {
      // Unblock is immediate — non-destructive.
      useChatStore
        .getState()
        .patchConversation(conv.id, { is_blocked: false });
      void setBlocked(user.id, otherId, conv.id, false)
        .then(() => toast.info("User unblocked"))
        .catch(() => {
          useChatStore
            .getState()
            .patchConversation(conv.id, { is_blocked: true });
          toast.danger("Couldn't unblock. Try again.");
        });
      return;
    }
    // Block — confirm first.
    setPendingAction({
      title: "Block this user?",
      body: "They won't be able to send you messages. You can unblock anytime from this menu.",
      confirmLabel: "Block",
      danger: true,
      run: async () => {
        useChatStore
          .getState()
          .patchConversation(conv.id, { is_blocked: true });
        try {
          await setBlocked(user.id, otherId, conv.id, true);
          // Push notification to the blocked user — matches v1
          // behaviour. Fire-and-forget; failure is non-fatal.
          notifyDMBlocked(otherId, user.full_name || "Someone").catch(
            () => {}
          );
          toast.warning("User blocked");
        } catch {
          useChatStore
            .getState()
            .patchConversation(conv.id, { is_blocked: false });
          toast.danger("Couldn't block. Try again.");
        }
      },
    });
  }, [user?.id, user?.full_name, conv, toast]);

  const handleClearChat = useCallback(() => {
    if (!user?.id || !conv) return;
    setPendingAction({
      title: "Clear this chat?",
      body: "Every message will disappear from your view. The other person still sees their copy.",
      confirmLabel: "Clear",
      danger: true,
      run: async () => {
        const store = useChatStore.getState();
        const convId = conv.id;
        // Wipe the visible thread immediately for snappy feedback.
        const thread = store.threadsByConversation[convId];
        if (thread) {
          store.setThread(convId, []);
        }
        // Drop the conversation-list preview too so the row's last
        // message line goes blank without a manual refresh.
        store.patchConversation(convId, {
          last_message_text: null,
          last_message_at: null,
          last_message_sender_id: null,
          unread_count: 0,
        });
        // Wipe the warm-start snapshot so revisiting doesn't briefly
        // flash the cleared messages.
        void deleteCachedThread(user.id, convId);
        try {
          await clearChatForUser(convId, user.id);
          toast.info("Chat cleared");
        } catch {
          toast.danger("Couldn't clear. Try again.");
        }
      },
    });
  }, [user?.id, conv, toast]);

  // === Per-message action handlers (Phase 4 — Interactions) ===
  // Stage 1 only ships Copy + Delete-for-me. Later stages bolt Reply,
  // React, Edit, Delete-for-everyone, Forward onto the same menu.

  const handleCopyMessage = useCallback(
    async (message: ChatMessage) => {
      const text = message.content ?? "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast.info("Copied");
      } catch {
        // Clipboard API can fail in older WebViews or insecure
        // contexts. Fall back to the textarea-select-copy trick.
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          toast.info("Copied");
        } catch {
          toast.danger("Couldn't copy.");
        }
      }
    },
    [toast]
  );

  // Toggle a reaction. Rules: same emoji from me → remove. New emoji
  // from me → swap (remove old, add new). The optimistic UI is
  // applied immediately via the store; the DB calls go through the
  // offline-aware action queue so an offline toggle survives the
  // disconnect and replays when the user is back online.
  const handleToggleReaction = useCallback(
    async (message: ChatMessage, emoji: string) => {
      if (!user?.id) return;
      const store = useChatStore.getState();
      const convId = message.conversation_id;
      const mine = (message.reactions || []).filter(
        (r) => r.user_id === user.id
      );
      const existingSame = mine.find((r) => r.emoji === emoji);
      if (existingSame) {
        // Toggle off — optimistic remove, queue the DB delete.
        store.removeReaction(convId, message.id, { id: existingSame.id });
        void dispatchOrQueue(user.id, {
          id: actionUuid(),
          kind: "react-remove",
          reaction_id: existingSame.id,
          conversation_id: convId,
          message_id: message.id,
          attempts: 0,
          last_error: null,
        });
        return;
      }
      // Different emoji or first reaction. Atomic swap in the store
      // first; then queue both the delete-old(s) AND the add-new so
      // they replay correctly across an offline / reconnect window.
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: MessageReaction = {
        id: tempId,
        message_id: message.id,
        user_id: user.id,
        emoji,
        created_at: new Date().toISOString(),
      };
      store.replaceMyReaction(convId, message.id, user.id, optimistic);
      for (const r of mine) {
        void dispatchOrQueue(user.id, {
          id: actionUuid(),
          kind: "react-remove",
          reaction_id: r.id,
          conversation_id: convId,
          message_id: message.id,
          attempts: 0,
          last_error: null,
        });
      }
      void dispatchOrQueue(user.id, {
        id: actionUuid(),
        kind: "react-add",
        message_id: message.id,
        conversation_id: convId,
        user_id: user.id,
        emoji,
        temp_reaction_id: tempId,
        attempts: 0,
        last_error: null,
      });
      // Notify the other side — but only if we're reacting to
      // THEIR message AND they're not currently looking at this
      // chat. The notification call is best-effort and doesn't
      // need to survive offline: by the time the user is back,
      // the recipient's chat will show the reaction either way.
      if (
        message.sender_id !== user.id &&
        conv &&
        conv.other_user_id &&
        !isUserViewingConversation(conv.other_user_id, convId)
      ) {
        notifyDMReaction(
          conv.other_user_id,
          user.full_name || "Someone",
          emoji,
          convId
        ).catch(() => {});
      }
    },
    [user?.id, user?.full_name, conv, toast]
  );

  const handleStartEdit = useCallback(
    (message: ChatMessage) => {
      if (!conversationId) return;
      // Save the current draft so we can restore it on cancel.
      savedDraftRef.current = draft;
      setEditingMessage(message);
      // Pre-fill the composer with the existing content.
      setDraft(conversationId, message.content || "");
      // If a reply context was open, dismiss it — edit and reply are
      // mutually exclusive modes for the composer.
      setReplyingTo(null);
    },
    [conversationId, draft, setDraft]
  );

  const handleCancelEdit = useCallback(() => {
    if (!conversationId) return;
    setEditingMessage(null);
    // Restore whatever the user had typed before they entered edit
    // mode. If they had nothing typed, this just clears the draft.
    setDraft(conversationId, savedDraftRef.current);
    savedDraftRef.current = "";
  }, [conversationId, setDraft]);

  const handleSubmitEdit = useCallback(async () => {
    if (!editingMessage || !conversationId || !user?.id) return;
    const next = draft.trim();
    if (!next) {
      toast.danger("Message can't be empty.");
      return;
    }
    if (next === (editingMessage.content || "").trim()) {
      // Nothing changed → just exit edit mode without a network call.
      handleCancelEdit();
      return;
    }
    // Optimistic patch — the realtime UPDATE echo will overwrite
    // with the authoritative timestamp once it lands. We DON'T
    // revert on API failure anymore because the action queue takes
    // over: if we're offline or the call fails, the edit replays
    // on reconnect and the store stays consistent the whole time.
    const optimisticEditedAt = new Date().toISOString();
    useChatStore.getState().patchMessage(conversationId, editingMessage.id, {
      content: next,
      edited_at: optimisticEditedAt,
    });
    setEditingMessage(null);
    setDraft(conversationId, savedDraftRef.current);
    savedDraftRef.current = "";
    void dispatchOrQueue(user.id, {
      id: actionUuid(),
      kind: "edit",
      message_id: editingMessage.id,
      conversation_id: conversationId,
      content: next,
      attempts: 0,
      last_error: null,
    });
  }, [editingMessage, conversationId, user?.id, draft, setDraft, toast, handleCancelEdit]);

  const handleDeleteForEveryone = useCallback(
    (message: ChatMessage) => {
      if (!user?.id) return;
      const convId = message.conversation_id;
      setPendingAction({
        title: "Delete for everyone?",
        body: "This message will be removed from both sides of the chat. This can't be undone.",
        confirmLabel: "Delete",
        danger: true,
        run: async () => {
          // Optimistic: flip the local copy to deleted so the bubble
          // renders as "Message deleted" instantly. We don't revert
          // on failure anymore — the queue will replay the UPDATE
          // when the user is back online and the bubble stays
          // consistent with intent in the meantime.
          useChatStore
            .getState()
            .patchMessage(convId, message.id, { is_deleted: true });
          void dispatchOrQueue(user.id, {
            id: actionUuid(),
            kind: "delete-all",
            message_id: message.id,
            conversation_id: convId,
            attempts: 0,
            last_error: null,
          });
        },
      });
    },
    [user?.id, toast]
  );

  const handleSubmitReport = useCallback(
    async (reason: UserReportReason, notes: string | null) => {
      if (!user?.id || !conv?.id) return;
      // Per-message report path (groups): use the message's sender
      // as the reported user and attach the message_id. Else fall
      // back to the conversation's other user (DM path).
      const reportedId = reportingMessage
        ? reportingMessage.sender_id
        : conv.other_user_id;
      if (!reportedId) return;
      try {
        await submitUserReport({
          reporterId: user.id,
          reportedId,
          conversationId: conv.id,
          messageId: reportingMessage?.id ?? null,
          reason,
          notes,
        });
        toast.info("Report submitted. Thanks for helping keep peja safe.");
        setReportOpen(false);
        setReportingMessage(null);
      } catch {
        toast.danger("Couldn't submit report. Try again.");
      }
    },
    [user?.id, conv, toast, reportingMessage]
  );

  const handleReportMessage = useCallback(
    (message: ChatMessage) => {
      setReportingMessage(message);
      setReportOpen(true);
    },
    []
  );

  // ---- Mentions composer typeahead ----
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // `mentionQuery` is null when the popover is closed; a string (possibly
  // empty) means the user just typed "@…" and the popover is open. We
  // also remember the start index of the @ token so insertMention can
  // splice the picked name back into the textarea.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState<number>(0);
  const [mentionIndex, setMentionIndex] = useState(0);

  const updateMentionContext = useCallback(
    (value: string, caret: number | null) => {
      if (caret == null) {
        setMentionQuery(null);
        return;
      }
      // Walk backwards from the caret to find an "@" with whitespace
      // (or start-of-string) before it and no space between it and the
      // caret. That gives the active mention query.
      let i = caret - 1;
      while (i >= 0) {
        const ch = value[i];
        if (ch === "@") {
          const before = i === 0 ? " " : value[i - 1];
          if (before === " " || before === "\n" || i === 0) {
            const q = value.slice(i + 1, caret);
            if (/^[A-Za-z0-9_'-]*$/.test(q)) {
              setMentionAnchor(i);
              setMentionQuery(q);
              setMentionIndex(0);
              return;
            }
          }
          break;
        }
        if (ch === " " || ch === "\n") break;
        i--;
      }
      setMentionQuery(null);
    },
    []
  );

  // Candidate list for the mentions popover. Pulls from
  // groupParticipants (sans current user) + an implicit "everyone"
  // sentinel for group-wide pings. DMs don't show the popover at
  // all because there's only one other person to mention.
  type MentionCandidate = {
    id: string;
    name: string;
    handle: string;
    subtitle?: string;
  };
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (mentionQuery === null) return [];
    if (!conv?.is_group) return [];
    const q = mentionQuery.toLowerCase();
    const everyone: MentionCandidate = {
      id: "__everyone__",
      name: "everyone",
      handle: "everyone",
      subtitle: "Notify all members",
    };
    const memberHits: MentionCandidate[] = (groupParticipants || [])
      .filter((p) => p.user_id !== user?.id)
      .map((p) => {
        const full = (p.full_name || "Member").trim();
        const first = full.split(/\s+/)[0] || "Member";
        // Build the inserted handle: prefer the first name; collapse
        // any special chars so the rendered token matches the
        // bubble-side MENTION_PATTERN (@[A-Za-z][A-Za-z0-9_'-]*).
        const handle = first.replace(/[^A-Za-z0-9_'-]/g, "");
        return { id: p.user_id, name: full, handle };
      })
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.handle.toLowerCase().startsWith(q));
    return [
      ...(q.length === 0 || "everyone".startsWith(q) ? [everyone] : []),
      ...memberHits,
    ];
  }, [mentionQuery, conv?.is_group, groupParticipants, user?.id]);

  const insertMention = useCallback(
    (c: { handle: string }) => {
      if (mentionQuery === null) return;
      const ta = composerRef.current;
      const value = draft;
      const start = mentionAnchor;
      // The token covered by mentionQuery runs from `start` (the "@")
      // up to `start + 1 + mentionQuery.length` (immediately after
      // the typed query). Replace that span with "@handle ".
      const tokenEnd = start + 1 + mentionQuery.length;
      const before = value.slice(0, start);
      const after = value.slice(tokenEnd);
      const replacement = `@${c.handle} `;
      const next = before + replacement + after;
      setDraft(conversationId, next);
      setMentionQuery(null);
      // Restore focus + caret after the inserted handle.
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        const pos = before.length + replacement.length;
        try {
          ta.setSelectionRange(pos, pos);
        } catch {}
      });
    },
    [conversationId, draft, mentionAnchor, mentionQuery, setDraft]
  );

  const handleTogglePinMessage = useCallback(
    async (message: ChatMessage) => {
      if (!conv?.id) return;
      const next = !message.is_pinned;
      const store = useChatStore.getState();

      // Apply the pin/unpin against the server + optimistic store
      // patch. Factored out so the swap path below can reuse it for
      // both the new pin and the implicit unpin of the existing one.
      const applyPin = async (msgId: string, value: boolean) => {
        store.patchMessage(conv.id!, msgId, {
          is_pinned: value,
          pinned_at: value ? new Date().toISOString() : null,
        });
        try {
          await apiSetMessagePinned(msgId, value);
        } catch (err) {
          store.patchMessage(conv.id!, msgId, {
            is_pinned: !value,
            pinned_at: !value ? new Date().toISOString() : null,
          });
          throw err;
        }
      };

      // Unpinning is always safe — no confirmation needed.
      if (!next) {
        try {
          await applyPin(message.id, false);
          toast.info("Unpinned");
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Couldn't update pin";
          toast.danger(msg);
        }
        return;
      }

      // Pinning. If another message is already pinned in this
      // conversation, ask before swapping. We enforce one pinned
      // message per conversation in the UI; the server side allows
      // multiple but the user expectation is "one important message
      // at a time".
      const existingPinned = (thread?.messages || []).find(
        (m) => m.is_pinned && !m.is_deleted && m.id !== message.id
      );

      if (existingPinned) {
        setPendingAction({
          title: "Replace pinned message?",
          body: `${pinSwapBody(existingPinned, message)}`,
          confirmLabel: "Replace",
          danger: false,
          run: async () => {
            try {
              // Unpin the old one first, then pin the new one. Sequential
              // so we don't briefly have two pinned messages on the
              // server (the optimistic patches mirror the order).
              await applyPin(existingPinned.id, false);
              await applyPin(message.id, true);
              toast.info("Pinned");
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "Couldn't update pin";
              toast.danger(msg);
            }
          },
        });
        return;
      }

      // No existing pin — straight pin.
      try {
        await applyPin(message.id, true);
        toast.info("Pinned");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't update pin";
        toast.danger(msg);
      }
    },
    [conv?.id, toast, thread?.messages]
  );

  const handleStartReply = useCallback(
    (message: ChatMessage) => {
      // Build a ReplyTarget snapshot from the message we're replying to.
      // Preview kind is derived from the first attached media row;
      // text-only messages get "text".
      let preview_kind: ReplyTarget["preview_kind"] = "text";
      if (message.media && message.media.length > 0) {
        const t = message.media[0].media_type;
        if (
          t === "image" ||
          t === "video" ||
          t === "audio" ||
          t === "document"
        ) {
          preview_kind = t;
        }
      }
      setReplyingTo({
        id: message.id,
        sender_id: message.sender_id,
        content: message.content,
        is_deleted: message.is_deleted,
        preview_kind,
      });
    },
    []
  );

  const handleDeleteForMe = useCallback(
    (message: ChatMessage) => {
      if (!user?.id) return;
      const convId = message.conversation_id;
      setPendingAction({
        title: "Delete this message?",
        body: "It'll disappear from your view. The other person still sees their copy.",
        confirmLabel: "Delete",
        danger: true,
        run: async () => {
          // Optimistic local removal — store stays consistent across
          // an offline window because the action queue replays the
          // insert into message_deletions on reconnect.
          useChatStore.getState().removeMessage(convId, message.id);
          void dispatchOrQueue(user.id, {
            id: actionUuid(),
            kind: "delete-me",
            message_id: message.id,
            conversation_id: convId,
            user_id: user.id,
            attempts: 0,
            last_error: null,
          });
        },
      });
    },
    [user?.id, toast]
  );

  const handleDeleteChat = useCallback(() => {
    if (!user?.id || !conv) return;
    const convId = conv.id;
    setPendingAction({
      title: "Delete this chat?",
      body: "It'll disappear from your list. If the other person messages you again, it'll come back.",
      confirmLabel: "Delete",
      danger: true,
      run: async () => {
        try {
          await deleteChatForUser(convId, user.id);
        } catch {
          toast.danger("Couldn't delete. Try again.");
          return;
        }
        useChatStore.getState().removeConversation(convId);
        // Drop the warm-start snapshot too — otherwise a stale
        // version of the deleted chat would flash on screen if
        // the conversation reappears later (e.g. the other side
        // messages us again).
        void deleteCachedThread(user.id, convId);
        toast.info("Chat deleted");
        router.push("/messages");
      },
    });
  }, [user?.id, conv, toast, router]);

  // ---- Group-specific handlers ----
  const [addMemberOpen, setAddMemberOpen] = useState(false);

  const refreshGroupAfterEdit = useCallback(async () => {
    if (!user?.id || !conv?.id) return;
    try {
      const list = await import("@/features/chat/api").then((m) =>
        m.fetchConversationList(user.id)
      );
      useChatStore.getState().setConversations(list);
      const parts = await fetchGroupParticipants(conv.id);
      setGroupParticipants(parts);
    } catch (err) {
      console.warn("[chat-v2] refreshGroupAfterEdit failed", err);
    }
  }, [user?.id, conv?.id]);

  const handleRenameGroup = useCallback(
    async (newName: string) => {
      if (!conv?.id) return;
      try {
        await apiRenameGroup(conv.id, newName);
        useChatStore.getState().patchConversation(conv.id, {
          group_name: newName,
          other_user_name: newName,
        });
        toast.info("Group renamed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't rename group";
        toast.danger(msg);
        throw err;
      }
    },
    [conv?.id, toast]
  );

  const handleChangeGroupAvatar = useCallback(
    async (file: File) => {
      if (!conv?.id || !user?.id) return;
      try {
        const url = await apiUploadGroupAvatar(file, user.id);
        await apiSetGroupAvatar(conv.id, url);
        useChatStore.getState().patchConversation(conv.id, {
          group_avatar_url: url,
          other_user_avatar_url: url,
        });
        toast.info("Group photo updated");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't update photo";
        toast.danger(msg);
      }
    },
    [conv?.id, user?.id, toast]
  );

  const handleRemoveGroupMember = useCallback(
    (userId: string) => {
      if (!conv?.id) return;
      const member = groupParticipants?.find((p) => p.user_id === userId);
      setPendingAction({
        title: `Remove ${member?.full_name || "this member"}?`,
        body: "They won't be able to see or send new messages in this group.",
        confirmLabel: "Remove",
        danger: true,
        run: async () => {
          try {
            await apiRemoveGroupMember(conv.id, userId);
            // Optimistically drop from local state; the realtime
            // refetch will reconcile if needed.
            setGroupParticipants((prev) =>
              prev ? prev.filter((p) => p.user_id !== userId) : prev
            );
            useChatStore.getState().patchConversation(conv.id, {
              member_count: Math.max((conv.member_count ?? 1) - 1, 0),
            });
            toast.info("Member removed");
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Couldn't remove member";
            toast.danger(msg);
          }
        },
      });
    },
    [conv?.id, conv?.member_count, groupParticipants, toast]
  );

  const handleLeaveGroup = useCallback(() => {
    if (!conv?.id) return;
    setPendingAction({
      title: "Leave this group?",
      body: "You'll stop receiving messages. The owner can add you back later.",
      confirmLabel: "Leave",
      danger: true,
      run: async () => {
        try {
          await apiLeaveGroup(conv.id);
          useChatStore.getState().removeConversation(conv.id);
          toast.info("Left the group");
          router.push("/messages");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Couldn't leave the group";
          toast.danger(msg);
        }
      },
    });
  }, [conv?.id, router, toast]);

  const handleDeleteGroup = useCallback(() => {
    if (!conv?.id) return;
    setPendingAction({
      title: "Delete this group?",
      body: "The group and every message in it will be removed for everyone. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
      run: async () => {
        try {
          await apiDeleteGroup(conv.id);
          useChatStore.getState().removeConversation(conv.id);
          toast.info("Group deleted");
          router.push("/messages");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Couldn't delete the group";
          toast.danger(msg);
        }
      },
    });
  }, [conv?.id, router, toast]);

  const handleSetNotificationMode = useCallback(
    async (mode: NotificationMode) => {
      if (!conv?.id) return;
      const prevMode = (conv as { notification_mode?: NotificationMode })
        .notification_mode || "all";
      useChatStore.getState().patchConversation(conv.id, {
        notification_mode: mode,
        is_muted: mode !== "all",
      });
      try {
        await apiSetNotificationMode(conv.id, mode);
        toast.info(
          mode === "all"
            ? "Notifications on"
            : mode === "mentions"
              ? "Only mentions will notify you"
              : "Notifications muted"
        );
      } catch (err) {
        useChatStore.getState().patchConversation(conv.id, {
          notification_mode: prevMode,
          is_muted: prevMode !== "all",
        });
        toast.danger("Couldn't update notifications");
      }
    },
    [conv?.id, conv, toast]
  );

  // Header subtitle priority: recording > typing > online > last seen.
  // Recording wins over typing because it's the more committed
  // signal — a user typing might trail off, but a user recording is
  // actively making a voice note for you. Groups don't have a single
  // "other side" presence so we show the member count instead.
  let headerSubtitle: string | null = null;
  if (conv?.is_group) {
    const n = conv.member_count ?? 0;
    headerSubtitle = `${n} member${n === 1 ? "" : "s"}`;
  } else if (isOtherRecording) {
    headerSubtitle = "recording…";
  } else if (isOtherTyping) {
    headerSubtitle = "typing…";
  } else if (otherOnline) {
    headerSubtitle = "online";
  } else if (otherLastSeen) {
    headerSubtitle = `last seen ${formatDistanceToNow(new Date(otherLastSeen), {
      addSuffix: true,
    })}`;
  }

  return (
    <div
      className={`fixed inset-0 flex flex-col bg-[var(--page-bg)] ${
        closing ? "peja-slide-out-to-right" : "peja-slide-in-from-right"
      }`}
    >
      <Header
        variant="back"
        title={conv?.other_user_name || "Chat"}
        subtitle={headerSubtitle}
        avatarUrl={conv?.other_user_avatar_url ?? null}
        onBack={handleBack}
        onAvatarTap={() => setShowAvatarPreview(true)}
        onTitleTap={() => setShowChatInfo(true)}
        actions={
          conv ? (
            <KebabMenu
              isMuted={conv.is_muted}
              isBlocked={conv.is_blocked}
              onOpenInfo={() => setShowChatInfo(true)}
              onSearch={() => setSearchOpen(true)}
              onToggleMute={handleToggleMute}
              onToggleBlock={handleToggleBlock}
              onClearChat={handleClearChat}
              onDeleteChat={
                conv.is_group
                  ? conv.my_role === "owner"
                    ? handleDeleteGroup
                    : handleLeaveGroup
                  : handleDeleteChat
              }
              onReport={() => setReportOpen(true)}
              isGroup={!!conv.is_group}
              myRole={conv.my_role}
              notificationMode={
                (conv as { notification_mode?: NotificationMode }).notification_mode || "all"
              }
              onSetNotificationMode={handleSetNotificationMode}
              onLeaveGroup={handleLeaveGroup}
            />
          ) : null
        }
      />

      <main
        ref={scrollRef}
        onScroll={handleThreadScroll}
        className="flex-1 overflow-y-auto overscroll-contain pt-app-header-pill px-4 pb-3 relative"
      >
        {!user && (
          <p className="text-sm text-dark-400 py-12 text-center">Sign in to view this chat.</p>
        )}

        {(() => {
          // Pinned-messages strip — fixed at the very top of the
          // scrollable area, just below the header. Shows the most
          // recently pinned message; tapping it scrolls + flashes
          // the original. If more than one is pinned, the count
          // pill on the right indicates how many.
          if (!thread?.hydrated) return null;
          const pinned = (thread.messages || []).filter(
            (m) => m.is_pinned && !m.is_deleted
          );
          if (pinned.length === 0) return null;
          // Most recently pinned shown first.
          pinned.sort((a, b) => {
            const ap = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
            const bp = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
            return bp - ap;
          });
          const top = pinned[0];
          const preview = top.is_deleted
            ? "Message deleted"
            : (top.content || "").trim() ||
              (top.media && top.media[0]
                ? top.media[0].media_type === "image"
                  ? "📷 Photo"
                  : top.media[0].media_type === "video"
                    ? "🎥 Video"
                    : top.media[0].media_type === "audio"
                      ? "🎙 Voice note"
                      : "📎 File"
                : "Pinned message");
          return (
            <button
              type="button"
              onClick={() => scrollToMessage(top.id)}
              // Full-bleed sticky banner. The parent <main> has px-4
              // padding for messages, but the pinned-message strip
              // should run edge-to-edge so the right side doesn't clip
              // when the preview is long (audio messages especially).
              // The classic "break-out of constrained parent" trick:
              // width:100vw with marginLeft / marginRight calculated to
              // cancel the parent's padding regardless of viewport size.
              className="sticky top-0 z-20 mb-2 px-4 py-2 flex items-center gap-2 bg-[var(--page-bg)]/95 backdrop-blur border-b border-[var(--chat-input-border)] text-left"
              style={{
                width: "100vw",
                marginLeft: "calc(50% - 50vw)",
                marginRight: "calc(50% - 50vw)",
              }}
              aria-label="Jump to pinned message"
            >
              <PinIcon className="w-3.5 h-3.5 text-primary-300 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[11px] font-semibold text-primary-300 leading-none mb-0.5">
                  Pinned message
                </span>
                <span className="block text-[12.5px] text-dark-200 truncate">
                  {preview}
                </span>
              </span>
              {pinned.length > 1 && (
                <span className="text-[10px] text-dark-400 bg-[var(--chat-input-bg)] rounded-full px-1.5 py-0.5">
                  {pinned.length}
                </span>
              )}
            </button>
          );
        })()}

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
                  <div className="h-10 w-40 bg-[var(--chat-input-bg)] rounded-2xl animate-pulse" />
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

        {user && thread?.hydrated && loadingOlder && (
          <div className="flex justify-center py-3" aria-hidden>
            <span className="text-[11px] text-dark-400 inline-flex items-center gap-2 bg-[var(--chat-other-bg)] rounded-full px-3 py-1">
              <span className="w-3 h-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
              Loading older messages…
            </span>
          </div>
        )}

        {user && thread?.hydrated && messages.length > 0 && (() => {
          // Iterate with two mutable counters: prevBucket lets us
          // insert a DateDivider before the first message of a new
          // calendar day; unreadInserted ensures the
          // "Unread messages" pill is drawn EXACTLY ONCE, above the
          // first message that came in after our snapshotted
          // last_read_at. Both are scoped to this render pass.
          let prevBucket: string | null = null;
          let unreadInserted = false;
          let prevSenderId: string | null = null;
          const readAt = initialReadAtRef.current ?? null;
          return (
          <div className="space-y-2 py-3">
            {messages.map((m) => {
              // System messages render as a centered pill, NOT a
              // bubble — used for group join / leave / rename
              // announcements. They short-circuit all the normal
              // bubble assembly logic below.
              if (m.content_type === "system") {
                const bucket = dateBucket(m.created_at);
                const showDate = bucket !== prevBucket;
                prevBucket = bucket;
                return (
                  <Fragment key={m.id}>
                    {showDate && (
                      <DateDivider key={`date-${bucket}`} iso={m.created_at} />
                    )}
                    <div className="flex justify-center py-1">
                      <span className="text-[11px] text-dark-400 bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] rounded-full px-2.5 py-1">
                        {m.content || "Group updated"}
                      </span>
                    </div>
                  </Fragment>
                );
              }
              const isMine = m.sender_id === user.id;
              const isFailed = m.delivery_status === "failed";
              const isPending = m.delivery_status === "pending";
              const hasMedia = !!(m.media && m.media.length > 0);
              // Visual (image / video) media gets the tight tile
              // padding so the asset fills the bubble corner-to-
              // corner. Audio-only and text use the standard text
              // padding (the audio bubble is its own widget).
              // For a deleted-for-everyone message we collapse the
              // bubble to a tombstone — no media tile, no audio
              // widget, no doc card. Forcing all of these to false
              // also flips bubbleClass to text-padding so the bubble
              // gets the right shape without the tile-tight `p-1`.
              const hasVisualMedia =
                !m.is_deleted &&
                hasMedia &&
                m.media!.some(
                  (md) => md.media_type === "image" || md.media_type === "video"
                );
              // Bucket + sender-run flags are computed here (above
              // bubbleInner) so the senderHeader pill can read them
              // when it's assembled inside bubbleInner. The date
              // divider logic below uses the same `bucket` value.
              const bucket = dateBucket(m.created_at);
              const isFirstInRun =
                prevSenderId !== m.sender_id || prevBucket !== bucket;
              const showSenderLabel =
                !!conv?.is_group && !isMine && isFirstInRun;
              const senderInfo = conv?.is_group
                ? groupParticipantsById?.[m.sender_id]
                : null;
              const showSenderAvatar = !!conv?.is_group && !isMine;
              // True when the message renders an inline incident
              // preview card. We use this only to give the meta row
              // a little more breathing room beneath the card so the
              // timestamp doesn't kiss the card's bottom edge.
              const hasIncidentPreview =
                !m.is_deleted && !!extractIncidentPostId(m.content);
              const hasAudio =
                !m.is_deleted &&
                hasMedia &&
                m.media!.some((md) => md.media_type === "audio");
              const hasDocument =
                !m.is_deleted &&
                hasMedia &&
                m.media!.some((md) => md.media_type === "document");
              // Audio + document bubbles render the timestamp + status
              // ticks INSIDE themselves (via metaTrailing) so the icon
              // / play button sits at the bubble's vertical centre.
              // When ANY of those is present we skip the parent's
              // external meta row — otherwise we'd render the meta
              // twice. Caption text + visual-only messages keep the
              // external meta row. Deleted messages render their own
              // meta inline so this stays false.
              const metaInsideBubble = hasAudio || hasDocument || m.is_deleted;
              const baseColor = isMine
                ? "bg-primary-600 text-white"
                : "bg-[var(--chat-other-bg)] text-dark-100";
              // `overflow-hidden` on the bubble is what actually clips
              // the rectangular media tile to the bubble's rounded
              // corners — without it, a single-image / single-video
              // tile pokes out the bubble's rounded edges because the
              // inner Tile itself doesn't carry a border-radius for
              // the 1-item case.
              // max-w-[78%] previously lived on the bubble itself,
              // which meant the bubble was 78% of its parent column.
              // Once we added the avatar/inner-column wrapper for
              // group sender labels the parent column shrunk to
              // fit-content, so 78% of that became "78% of the
              // bubble's own natural width" and every bubble looked
              // pinched. The cap now lives on the inner column
              // (assigned in the row wrapper below) so the bubble
              // grows naturally to its content within that cap.
              const bubbleClass = `rounded-2xl ${
                hasVisualMedia ? "p-1 overflow-hidden" : "px-3.5 py-2"
              } ${baseColor} ${
                isFailed ? "opacity-70 border border-red-500/60 cursor-pointer" : ""
              }`;
              // Partition media by kind so each gets its proper layout:
              //   • audios → AudioBubble (one per row)
              //   • documents → DocumentBubble (one per row)
              //   • images / videos → MediaGrid (one shared grid)
              //
              // In practice each message contains only one kind because
              // handleSend splits sends, but the rendering supports
              // mixed messages for robustness against older / migrated
              // data.
              const audioMedia = hasMedia
                ? m.media!.filter((md) => md.media_type === "audio")
                : [];
              const docMedia = hasMedia
                ? m.media!.filter((md) => md.media_type === "document")
                : [];
              const visualMedia: MediaGridItem[] = hasMedia
                ? m.media!
                    .filter(
                      (md) =>
                        md.media_type === "image" || md.media_type === "video"
                    )
                    .map((md) => ({
                      id: md.id,
                      url: md.url,
                      media_type: md.media_type as "image" | "video",
                      thumbnail_url: md.thumbnail_url,
                      width: md.width,
                      height: md.height,
                    }))
                : [];
              // When a message has been deleted FOR EVERYONE we render
              // a minimal placeholder bubble — no media tile, no reply
              // preview, no caption. Just the "Message deleted" line +
              // the meta row. This matches WhatsApp: a tombstone bubble
              // that gives the conversation context without leaking
              // the original content's footprint.
              // Sender name pill that sits inside the bubble, matching
              // the WhatsApp pattern. Only renders on the first bubble
              // of a sender's run in a group, and only on incoming
              // bubbles (your own messages are obviously yours).
              const senderHeader = showSenderLabel ? (
                <p
                  className={`text-[12px] font-semibold mb-0.5 ${
                    hasVisualMedia ? "px-2.5 pt-1.5" : ""
                  }`}
                  style={{ color: pejaSenderColor(m.sender_id) }}
                >
                  {senderInfo?.full_name || "Member"}
                </p>
              ) : null;

              const bubbleInner = m.is_deleted ? (
                <>
                  {senderHeader}
                  <p className="text-sm italic opacity-70 inline-flex items-center gap-1.5">
                    <Ban className="w-3.5 h-3.5" />
                    <span>Message deleted</span>
                  </p>
                  <div
                    className={`flex items-center justify-end gap-1 mt-0.5 ${
                      isMine ? "text-white/70" : "text-dark-500"
                    }`}
                  >
                    {m.edited_at && (
                      <span className="text-[10px] italic mr-1 opacity-70">
                        edited
                      </span>
                    )}
                    <span className="text-[10px]">
                      {format(new Date(m.created_at), "HH:mm")}
                    </span>
                    {isMine && (
                      <span className="text-[10px]">
                        {m.delivery_status === "sent" && "✓"}
                        {m.delivery_status === "seen" && "✓✓"}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {senderHeader}
                  {m.reply_to && (
                    <QuotedReplyBlock
                      target={m.reply_to}
                      authorName={
                        user && m.reply_to.sender_id === user.id
                          ? "You"
                          : conv?.other_user_name || "User"
                      }
                      variant={isMine ? "mine" : "theirs"}
                      onJumpToOriginal={() => {
                        if (m.reply_to) scrollToMessage(m.reply_to.id);
                      }}
                    />
                  )}
                  {audioMedia.map((media) => {
                    // Render the time + status ticks INSIDE the audio
                    // bubble so the parent doesn't also render its own
                    // status row underneath (which makes the player
                    // look off-centre).
                    const meta = (
                      <>
                        {m.edited_at && (
                          <span className="italic opacity-75">edited</span>
                        )}
                        <span>{format(new Date(m.created_at), "HH:mm")}</span>
                        {isMine && (
                          <span>
                            {isPending && "..."}
                            {m.delivery_status === "sent" && "✓"}
                            {m.delivery_status === "seen" && "✓✓"}
                          </span>
                        )}
                      </>
                    );
                    return (
                      <AudioBubble
                        key={media.id}
                        url={media.url}
                        initialDuration={undefined}
                        variant={isMine ? "mine" : "theirs"}
                        metaTrailing={meta}
                        isPending={isPending}
                        uploadFraction={uploadProgressById[m.id]?.fraction}
                        onCancelUpload={() => handleCancel(m.id)}
                      />
                    );
                  })}
                  {docMedia.length > 0 && (
                    <div className="space-y-1">
                      {docMedia.map((media, i) => {
                        // Attach the meta (timestamp + ticks) to the
                        // LAST doc bubble of the message. With a single
                        // doc that's the only bubble; with multiple
                        // docs in one message the others just show
                        // file size on the right and the last one
                        // carries the time.
                        const isLast = i === docMedia.length - 1;
                        const meta = isLast ? (
                          <>
                            {m.edited_at && (
                              <span className="italic opacity-75">edited</span>
                            )}
                            <span>{format(new Date(m.created_at), "HH:mm")}</span>
                            {isMine && (
                              <span>
                                {isPending && "..."}
                                {m.delivery_status === "sent" && "✓"}
                                {m.delivery_status === "seen" && "✓✓"}
                              </span>
                            )}
                          </>
                        ) : undefined;
                        return (
                          <DocumentBubble
                            key={media.id}
                            url={media.url}
                            fileName={media.file_name || "File"}
                            fileSize={media.file_size}
                            variant={isMine ? "mine" : "theirs"}
                            isPending={isPending}
                            isFailed={isFailed}
                            uploadFraction={uploadProgressById[m.id]?.fraction}
                            onCancelUpload={() => handleCancel(m.id)}
                            onOpen={() =>
                              setDocViewer({
                                url: media.url,
                                fileName: media.file_name || "File",
                              })
                            }
                            metaTrailing={meta}
                          />
                        );
                      })}
                    </div>
                  )}
                  {visualMedia.length > 0 && (
                    <div className="relative">
                      <MediaGrid
                        items={visualMedia}
                        isPending={isPending}
                        onTileTap={(idx) =>
                          setLightbox({
                            items: visualMedia.map((md) => ({
                              url: md.url,
                              type: md.media_type,
                              posterUrl: md.thumbnail_url || undefined,
                            })),
                            index: idx,
                          })
                        }
                      />
                      {isPending && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="pointer-events-auto">
                            <UploadRing
                              fraction={uploadProgressById[m.id]?.fraction ?? 0}
                              label={uploadProgressById[m.id]?.label}
                              showLabel
                              onCancel={() => handleCancel(m.id)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {m.is_deleted ? (
                    <p
                      className={`text-sm italic opacity-70 ${
                        hasVisualMedia ? "px-2.5 pt-1.5" : ""
                      }`}
                    >
                      Message deleted
                    </p>
                  ) : (
                    m.content && (() => {
                      const incidentId = extractIncidentPostId(m.content);
                      // Whenever a message contains an incident URL we
                      // hide the text body entirely and show only the
                      // preview card — the card already carries the
                      // category, comment, location, and time, so the
                      // raw URL + post caption above it is duplicate
                      // noise. Earlier-style forwards (caption + URL)
                      // also collapse cleanly under this rule.
                      return (
                        <>
                          {!incidentId && (
                            <p
                              className={`text-sm whitespace-pre-wrap break-words ${
                                hasVisualMedia ? "px-2.5 pt-1.5" : ""
                              }`}
                            >
                              <MessageText
                                text={m.content}
                                linkClass={
                                  isMine ? "text-white/90" : "text-primary-300"
                                }
                                // On the sender-side purple bubble
                                // the regular .peja-mention violet
                                // disappears into the bg; override
                                // with white for visibility there.
                                mentionClass={
                                  isMine
                                    ? "text-white font-semibold underline decoration-white/60 underline-offset-2"
                                    : undefined
                                }
                              />
                            </p>
                          )}
                          {incidentId && (
                            <div
                              className={hasVisualMedia ? "px-2.5 pb-1" : ""}
                            >
                              <IncidentLinkPreview
                                postId={incidentId}
                                variant={isMine ? "mine" : "theirs"}
                              />
                            </div>
                          )}
                        </>
                      );
                    })()
                  )}
                  {/* Audio + document bubbles render the timestamp +
                      status ticks INSIDE themselves so the icon sits
                      at the bubble's vertical centre. Skip the
                      external meta row in those cases — otherwise
                      we'd render it twice. */}
                  {!metaInsideBubble && (
                  <div
                    className={`flex items-center justify-end gap-1 ${
                      hasVisualMedia
                        ? "mt-1.5 px-2.5 pb-1"
                        : hasIncidentPreview
                          ? "mt-1.5"
                          : "mt-0.5"
                    }`}
                  >
                    {isFailed && isMine ? (
                      <>
                        <span className="text-[10px] text-white/80">Tap to retry</span>
                        <span className="text-[10px] text-red-300">!</span>
                      </>
                    ) : (
                      <>
                        {m.edited_at && (
                          <span
                            className={`text-[10px] italic ${
                              isMine ? "text-white/65" : "text-dark-400"
                            }`}
                          >
                            edited
                          </span>
                        )}
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
                  )}
                </>
              );
              const highlighted = highlightedMessageId === m.id;
              const reactionBadges =
                m.reactions && m.reactions.length > 0 ? (
                  <ReactionBadges
                    reactions={m.reactions}
                    currentUserId={user?.id ?? null}
                    variant={isMine ? "mine" : "theirs"}
                    onToggle={(emoji) => handleToggleReaction(m, emoji)}
                  />
                ) : null;
              // Compute the dividers to emit BEFORE this message row.
              // bucket is already computed above (used by the sender
              // header pill); we just consume it here.
              const dividers: React.ReactNode[] = [];
              if (bucket !== prevBucket) {
                dividers.push(
                  <DateDivider key={`date-${bucket}`} iso={m.created_at} />
                );
                prevBucket = bucket;
              }
              if (
                !unreadInserted &&
                m.sender_id !== user.id &&
                (!readAt || m.created_at > readAt)
              ) {
                dividers.push(<UnreadDivider key="unread-divider" />);
                unreadInserted = true;
              }
              prevSenderId = m.sender_id;
              return (
                <Fragment key={m.id}>
                {dividers}
                <div
                  data-message-id={m.id}
                  className={`flex ${
                    isMine ? "justify-end" : "justify-start"
                  } items-end gap-2`}
                >
                  {showSenderAvatar &&
                    (isFirstInRun ? (
                      <span className="shrink-0 w-7 h-7 rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center self-end">
                        {senderInfo?.avatar_url ? (
                          <img
                            src={senderInfo.avatar_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="w-3.5 h-3.5 text-dark-400" />
                        )}
                      </span>
                    ) : (
                      <span className="shrink-0 w-7" aria-hidden />
                    ))}
                <div
                  className={`flex flex-col max-w-[78%] ${
                    isMine ? "items-end" : "items-start"
                  }`}
                >
                  {isFailed && isMine ? (
                    <button
                      type="button"
                      onClick={() => handleRetry(m.id)}
                      className={`${bubbleClass} text-left ${
                        highlighted ? "peja-highlight-flash" : ""
                      }`}
                      aria-label="Retry sending this message"
                    >
                      {bubbleInner}
                    </button>
                  ) : isPending ? (
                    // Pending messages don't get the action menu — the
                    // optimistic bubble has no server id yet, so most
                    // actions (delete-for-me, future react/reply) would
                    // need to wait for confirm. The progress ring +
                    // cancel-X cover the relevant interactions.
                    <div
                      className={`${bubbleClass} ${
                        highlighted ? "peja-highlight-flash" : ""
                      }`}
                    >
                      {bubbleInner}
                    </div>
                  ) : (
                    <MessageBubbleWrapper
                      isMine={isMine}
                      bubbleClass={bubbleClass}
                      highlighted={highlighted}
                      onOpenMenu={(anchor) =>
                        setActiveMenu({ message: m, anchor })
                      }
                      onSwipeReply={() => handleStartReply(m)}
                    >
                      {bubbleInner}
                    </MessageBubbleWrapper>
                  )}
                  {reactionBadges}
                </div>
                </div>
                </Fragment>
              );
            })}
          </div>
          );
        })()}

        {/* In-thread activity indicator. Small left-aligned bubble
            where an incoming message would appear. Pulsing chat-bubble
            icon while typing; pulsing mic icon while recording a
            voice note. The header subtitle ("typing…" / "recording…")
            stays as the text companion. */}
        {user && (isOtherTyping || isOtherRecording) && (
          <div className="flex justify-start pb-3 pt-1">
            <div className="rounded-2xl bg-[var(--chat-other-bg)] text-dark-100 px-3 py-2 inline-flex items-center">
              {isOtherRecording ? (
                <Mic
                  className="w-4 h-4 text-red-400 animate-pulse"
                  strokeWidth={2.25}
                  aria-label="Recording"
                />
              ) : (
                <MessageSquare
                  className="w-4 h-4 text-primary-300 animate-pulse"
                  strokeWidth={2.25}
                  aria-label="Typing"
                />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Floating "new messages while you were scrolled up" indicator.
          Avatar pops out from the bottom-right of the scroll area
          (above the composer) with the unread-since-scroll count.
          Tap → smooth-scroll to bottom + clear. We deliberately
          render this OUTSIDE the scrollable <main> so it stays
          fixed-position relative to the thread chrome. */}
      {unseenCount > 0 && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute right-3 z-30 flex items-center justify-center w-12 h-12 rounded-full bg-[var(--chat-other-bg)] shadow-lg ring-1 ring-[var(--chat-input-border)] active:scale-95 transition-transform peja-pop-in"
          style={{
            // Sit just above the composer / blocked banner.
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 78px)",
          }}
          aria-label={`Scroll to latest, ${unseenCount} new message${unseenCount > 1 ? "s" : ""}`}
        >
          <span className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center bg-[var(--chat-input-bg)]">
            {conv?.other_user_avatar_url ? (
              <img
                src={conv.other_user_avatar_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <ChevronDown className="w-5 h-5 text-dark-200" />
            )}
          </span>
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold rounded-full bg-primary-600 text-white tabular-nums">
            {unseenCount > 99 ? "99+" : unseenCount}
          </span>
        </button>
      )}

      <div
        className="border-t border-[var(--chat-input-border)] bg-[var(--page-bg)] px-3 py-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        {!conv?.blocked_by_other && editingMessage && (
          <div className="max-w-2xl mx-auto mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--chat-input-bg)] border-l-2 border-primary-500">
            <Pencil className="w-3.5 h-3.5 text-primary-300 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-primary-300">
                Editing message
              </p>
              <p className="text-xs text-dark-400 truncate">
                {editingMessage.content || ""}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="shrink-0 w-7 h-7 rounded-full bg-[var(--chat-input-hover)] flex items-center justify-center"
              aria-label="Cancel edit"
            >
              <X className="w-3.5 h-3.5 text-dark-200" />
            </button>
          </div>
        )}
        {!conv?.blocked_by_other && replyingTo && !editingMessage && (
          <ReplyPreview
            target={replyingTo}
            authorName={
              user && replyingTo.sender_id === user.id
                ? "yourself"
                : conv?.other_user_name || "user"
            }
            onDismiss={() => setReplyingTo(null)}
          />
        )}
        {conv?.blocked_by_other ? (
          // The other user has blocked us. Replace the composer with a
          // static notice — same visual height + safe-area handling as
          // the real composer so the layout doesn't jump when block /
          // unblock toggles via realtime.
          <div className="max-w-2xl mx-auto flex items-center justify-center gap-2 py-2 text-sm text-dark-300 text-center">
            <Ban className="w-4 h-4 text-red-400 shrink-0" />
            <span>
              You can&apos;t reply to this chat.{" "}
              <span className="text-dark-400">
                {conv.other_user_name || "This user"} has blocked you.
              </span>
            </span>
          </div>
        ) : (
          <>
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
        <div className="flex items-center gap-2 max-w-2xl mx-auto">
          {/* Hidden file input — used by the attach button below. No
              `accept` filter so the picker offers images, videos AND
              documents (PDF, doc/docx, etc.). The pipeline routes each
              file through chatMedia.ts which picks the right
              media_type and upload destination. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFilesPicked}
            className="hidden"
          />

          {/* Attach + textarea are hidden while voice recording fills
              the row. The VoiceRecorderBar tells us via its
              onActiveChange callback when it's expanded. */}
          {!recording && (
            <>
              {!editingMessage && (
                <button
                  type="button"
                  onClick={handleAttachClick}
                  className="shrink-0 w-10 h-10 rounded-full bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] text-dark-200 flex items-center justify-center hover:bg-[var(--chat-input-hover)] active:scale-90 transition-all"
                  aria-label="Attach file"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
              )}
              <div className="flex-1 relative rounded-2xl bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] focus-within:border-primary-500/40">
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(conversationId, e.target.value);
                    if (e.target.value.length > 0) sendTyping();
                    updateMentionContext(e.target.value, e.target.selectionStart);
                  }}
                  onKeyDown={(e) => {
                    // When the mentions popover is open, arrow keys
                    // and Enter/Tab navigate it instead of the
                    // textarea. Escape always closes it first.
                    if (mentionQuery !== null) {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMentionQuery(null);
                        return;
                      }
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIndex((i) => Math.min(i + 1, mentionCandidates.length - 1));
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIndex((i) => Math.max(i - 1, 0));
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        if (mentionCandidates.length > 0) {
                          e.preventDefault();
                          insertMention(mentionCandidates[mentionIndex]);
                          return;
                        }
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (editingMessage) {
                        void handleSubmitEdit();
                      } else {
                        handleSend();
                      }
                    } else if (e.key === "Escape" && editingMessage) {
                      e.preventDefault();
                      handleCancelEdit();
                    }
                  }}
                  onSelect={(e) => {
                    updateMentionContext(
                      (e.target as HTMLTextAreaElement).value,
                      (e.target as HTMLTextAreaElement).selectionStart
                    );
                  }}
                  onBlur={() => {
                    // Defer so a click on a candidate row lands before
                    // we close the popover.
                    window.setTimeout(() => setMentionQuery(null), 120);
                  }}
                  placeholder={editingMessage ? "Edit message" : "Message"}
                  rows={1}
                  onScroll={(e) => {
                    if (overlayRef.current) {
                      overlayRef.current.scrollTop = e.currentTarget.scrollTop;
                      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
                    }
                  }}
                  // The textarea sits ON TOP with transparent text +
                  // transparent bg, so the styled mirror behind it
                  // shows through. Caret stays visible via
                  // caret-color. The wrapper carries the bg/border
                  // chrome so the textarea doesn't paint over the
                  // overlay.
                  style={{
                    color: "transparent",
                    caretColor: "var(--color-dark-100)",
                    background: "transparent",
                  }}
                  className="w-full max-h-32 resize-none bg-transparent px-3 pt-3 pb-1 text-sm placeholder-dark-500 focus:outline-none relative z-10"
                />
                {/* Styled mirror — sits BEHIND the textarea (z-0)
                    and renders the draft with @mentions in purple.
                    Same padding / type so each glyph lines up under
                    the (transparent) textarea text. */}
                <div
                  ref={overlayRef}
                  aria-hidden
                  className="absolute inset-0 max-h-32 overflow-hidden px-3 pt-3 pb-1 text-sm text-dark-100 whitespace-pre-wrap break-words pointer-events-none z-0"
                >
                  {(() => {
                    const re = /(^|\s)(@everyone|@all|@[A-Za-z][A-Za-z0-9_'-]*)/g;
                    const segs: Array<{ type: "text" | "mention"; value: string }> = [];
                    let last = 0;
                    let m: RegExpExecArray | null;
                    while ((m = re.exec(draft)) !== null) {
                      const prefixEnd = m.index + m[1].length;
                      if (prefixEnd > last) {
                        segs.push({ type: "text", value: draft.slice(last, prefixEnd) });
                      }
                      const tokenEnd = prefixEnd + m[2].length;
                      segs.push({ type: "mention", value: draft.slice(prefixEnd, tokenEnd) });
                      last = tokenEnd;
                    }
                    if (last < draft.length) {
                      segs.push({ type: "text", value: draft.slice(last) });
                    }
                    // Add a zero-width trailing space if the draft
                    // ends in a newline so the mirror keeps the
                    // trailing line that the textarea renders for
                    // the next character.
                    const trailingNewline = draft.endsWith("\n") ? "​" : "";
                    return (
                      <>
                        {segs.map((s, i) =>
                          s.type === "mention" ? (
                            <span key={i} className="peja-mention">
                              {s.value}
                            </span>
                          ) : (
                            <span key={i}>{s.value}</span>
                          )
                        )}
                        {trailingNewline}
                      </>
                    );
                  })()}
                </div>
                {mentionQuery !== null && mentionCandidates.length > 0 && (
                  <ul
                    role="listbox"
                    className="absolute bottom-full left-0 right-0 mb-1 max-h-56 overflow-y-auto rounded-xl bg-[var(--glass-card-bg)] border border-[var(--glass-border-sm)] shadow-lg z-50"
                  >
                    {mentionCandidates.map((c, i) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertMention(c)}
                          className={`w-full flex items-center gap-2 px-2.5 py-2 text-left ${
                            i === mentionIndex
                              ? "bg-[var(--chat-input-hover)]"
                              : "hover:bg-[var(--chat-input-hover)]"
                          }`}
                        >
                          <span className="shrink-0 w-7 h-7 rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center text-[10px] font-semibold text-primary-300">
                            {c.id === "__everyone__" ? "@all" : (c.name[0] || "?").toUpperCase()}
                          </span>
                          <span className="flex-1 min-w-0 text-sm text-dark-100 truncate">
                            {c.name}
                          </span>
                          {c.subtitle && (
                            <span className="shrink-0 text-[10px] text-dark-400">
                              {c.subtitle}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* Right-hand action slot.
              In edit mode → check (save edit) button, exclusive.
              Otherwise → the VoiceRecorderBar lives here in its
              idle/hold/locked states, AND a Send button is layered
              on top of the idle mic when the user has text or
              pending files. The send overlay fades + rotates in
              over the mic so the swap reads as one fluid morph
              instead of an abrupt unmount-and-remount. When
              recording, the bar expands into the row and the send
              overlay is removed from the DOM entirely. */}
          {editingMessage ? (
            <button
              type="button"
              onClick={() => void handleSubmitEdit()}
              disabled={!draft.trim()}
              className="shrink-0 w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center disabled:opacity-50 active:scale-90 transition-transform"
              aria-label="Save edit"
            >
              <Check className="w-4 h-4" />
            </button>
          ) : (
            <div
              className={`relative ${
                recording ? "flex-1 flex" : "w-10 h-10 shrink-0"
              }`}
            >
              <VoiceRecorderBar
              maxSeconds={120}
              onRecordingTick={sendRecording}
              onActiveChange={setRecording}
              onAutoStopped={() =>
                toast.danger("Voice note maxed at 2 minutes. Sending now.")
              }
              onSend={(file) => {
                // Capture + clear the reply context BEFORE the await so
                // a follow-up VN doesn't accidentally inherit it.
                const replyForVN = replyingTo;
                if (replyForVN) setReplyingTo(null);
                void (async () => {
                  try {
                    await send(conversationId, "", [file], replyForVN);
                  } catch {
                    toast.danger("Failed to send. Tap the message to retry.");
                  }
                })();
              }}
              onCancel={() => { /* state already reset internally */ }}
            />
              {/* Send-button overlay. Rendered on top of the idle
                  mic so the icon swap is a single crossfade +
                  rotation rather than an unmount-and-remount. The
                  send button is only mounted while we're NOT
                  recording — when recording starts, the VoiceRecorder
                  expands and we don't want a phantom send button
                  sitting in the corner. */}
              {!recording && (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={
                    !(draft.trim().length > 0 || pendingFiles.length > 0)
                  }
                  className={`absolute inset-0 rounded-full bg-primary-600 text-white flex items-center justify-center transition-all duration-200 ease-out ${
                    draft.trim().length > 0 || pendingFiles.length > 0
                      ? "opacity-100 scale-100 rotate-0 pointer-events-auto"
                      : "opacity-0 scale-50 -rotate-180 pointer-events-none"
                  }`}
                  aria-label="Send"
                  aria-hidden={
                    !(draft.trim().length > 0 || pendingFiles.length > 0)
                  }
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
          </>
        )}
      </div>

      {/* Fullscreen viewer for image / video bundles. Single component
          handles both types and any number of items — taps inside a
          bubble's grid pass the whole array and the tapped index so
          users can swipe through the rest of the album. */}
      {lightbox && (
        <MediaCarousel
          items={lightbox.items}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
      {docViewer && (
        <DocumentViewer
          url={docViewer.url}
          fileName={docViewer.fileName}
          onClose={() => setDocViewer(null)}
        />
      )}

      {reportOpen && conv?.other_user_id && (
        <ReportUserModal
          reportedName={conv.other_user_name || "this user"}
          onClose={() => setReportOpen(false)}
          onSubmit={handleSubmitReport}
        />
      )}

      {searchOpen && conv && user && (
        <SearchInChatSheet
          conversationId={conv.id}
          currentUserId={user.id}
          otherUserName={conv.other_user_name}
          onClose={() => setSearchOpen(false)}
          onJumpTo={async (messageId) => {
            // If the message is already in the rendered window,
            // scrollToMessage is enough. Otherwise walk pagination
            // backward until it's loaded — same loop as the
            // ?focus= handler, scoped to this single tap.
            const inStore = (
              useChatStore.getState().threadsByConversation[conv.id]?.messages ||
              []
            ).some((m) => m.id === messageId);
            if (!inStore) {
              for (let i = 0; i < 10; i++) {
                if (!hasMoreOlderRef.current) break;
                await loadOlderMessages();
                const nowIn = (
                  useChatStore.getState().threadsByConversation[conv.id]
                    ?.messages || []
                ).some((m) => m.id === messageId);
                if (nowIn) break;
              }
            }
            scrollToMessage(messageId);
          }}
        />
      )}

      {forwardSource && user && (
        <ForwardSheet
          excludeConversationId={conversationId}
          onClose={() => setForwardSource(null)}
          onForward={async (targetIds) => {
            try {
              await apiForwardMessage(forwardSource, targetIds, user.id);
              setForwardSource(null);
              toast.info(
                targetIds.length === 1
                  ? "Forwarded"
                  : `Forwarded to ${targetIds.length} chats`
              );
            } catch {
              toast.danger("Couldn't forward. Try again.");
            }
          }}
        />
      )}

      {showAvatarPreview && (
        <AvatarPreview
          url={conv?.other_user_avatar_url ?? null}
          name={conv?.other_user_name ?? null}
          onClose={() => setShowAvatarPreview(false)}
        />
      )}

      {showChatInfo && conv && user && (
        <ChatInfoSheet
          conversationId={conv.id}
          currentUserId={user.id}
          otherUserName={conv.other_user_name}
          otherUserAvatarUrl={conv.other_user_avatar_url}
          statusLine={headerSubtitle}
          isMuted={conv.is_muted}
          isBlocked={conv.is_blocked}
          onClose={() => setShowChatInfo(false)}
          onAvatarTap={() => setShowAvatarPreview(true)}
          onToggleMute={handleToggleMute}
          onToggleBlock={handleToggleBlock}
          onClearChat={() => {
            setShowChatInfo(false);
            handleClearChat();
          }}
          onDeleteChat={() => {
            setShowChatInfo(false);
            handleDeleteChat();
          }}
          onReport={() => {
            setShowChatInfo(false);
            setReportOpen(true);
          }}
          onOpenMedia={(items, index, kind) => {
            if (kind === "visual") {
              setLightbox({
                items: items.map((md) => ({
                  url: md.url,
                  type: md.media_type as "image" | "video",
                  posterUrl: md.thumbnail_url || undefined,
                })),
                index,
              });
            } else if (kind === "document") {
              const md = items[index];
              setDocViewer({
                url: md.url,
                fileName: md.file_name || "File",
              });
            } else {
              // Audio: open in document viewer (browser plays audio
              // natively). A dedicated voice-note viewer can come later.
              const md = items[index];
              setDocViewer({
                url: md.url,
                fileName: md.file_name || "Voice note",
              });
            }
          }}
          onOpenLink={(url) => {
            const a = document.createElement("a");
            a.href = url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.click();
          }}
          isGroup={!!conv.is_group}
          myRole={conv.my_role}
          memberCount={conv.member_count}
          participants={groupParticipants}
          notificationMode={
            (conv as { notification_mode?: NotificationMode }).notification_mode || "all"
          }
          onSetNotificationMode={handleSetNotificationMode}
          onLeaveGroup={() => {
            setShowChatInfo(false);
            handleLeaveGroup();
          }}
          onDeleteGroup={() => {
            setShowChatInfo(false);
            handleDeleteGroup();
          }}
          onRenameGroup={handleRenameGroup}
          onChangeGroupAvatar={handleChangeGroupAvatar}
          onAddMember={() => setAddMemberOpen(true)}
          onRemoveMember={handleRemoveGroupMember}
        />
      )}

      {addMemberOpen && user && conv?.is_group && (
        <AddMemberSheet
          conversationId={conv.id}
          currentUserId={user.id}
          existingMemberIds={
            new Set((groupParticipants || []).map((p) => p.user_id))
          }
          onClose={() => setAddMemberOpen(false)}
          onAdded={async () => {
            await refreshGroupAfterEdit();
          }}
        />
      )}

      {activeMenu && (() => {
        const m = activeMenu.message;
        const isMine = user ? m.sender_id === user.id : false;
        const isTextOnly = !m.media || m.media.length === 0;
        const hasContent = !!(m.content && m.content.trim());
        // Note: visibility flags here are deliberately conservative —
        // every later Phase 4 stage will add more actions to this menu
        // (Reply, React, Edit, Delete-for-everyone, Forward).
        const actions: MenuAction[] = [
          {
            key: "reply",
            label: "Reply",
            icon: <ReplyIcon className="w-4 h-4" />,
            onClick: () => handleStartReply(m),
            visible: !m.is_deleted,
          },
          {
            key: "copy",
            label: "Copy",
            icon: <CopyIcon className="w-4 h-4" />,
            onClick: () => handleCopyMessage(m),
            // Only meaningful when there's text. Media-only bubbles
            // hide the action — copying a blob: URL isn't useful.
            visible: hasContent && isTextOnly && !m.is_deleted,
          },
          {
            key: "edit",
            label: "Edit",
            icon: <Pencil className="w-4 h-4" />,
            onClick: () => handleStartEdit(m),
            // Mine + text-only + not already deleted. Phase 4 honours
            // the no-time-limit rule from the HANDOFF spec.
            visible: isMine && hasContent && isTextOnly && !m.is_deleted,
          },
          {
            key: "forward",
            label: "Forward",
            icon: <ForwardIcon className="w-4 h-4" />,
            onClick: () => setForwardSource(m),
            visible: !m.is_deleted,
          },
          {
            key: "pin",
            label: m.is_pinned ? "Unpin message" : "Pin message",
            icon: m.is_pinned ? (
              <PinOff className="w-4 h-4" />
            ) : (
              <PinIcon className="w-4 h-4" />
            ),
            onClick: () => handleTogglePinMessage(m),
            visible: !m.is_deleted,
          },
          {
            key: "report-msg",
            label: "Report message",
            icon: <FlagIcon className="w-4 h-4" />,
            danger: true,
            // Per-message report only makes sense for OTHER people's
            // messages — you can't usefully report yourself — and we
            // keep it group-only because DMs already expose
            // "Report user" via the chat-info sheet.
            onClick: () => handleReportMessage(m),
            visible: !isMine && !m.is_deleted && !!conv?.is_group,
          },
          {
            key: "delete-everyone",
            label: "Delete for everyone",
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onClick: () => handleDeleteForEveryone(m),
            visible: isMine && !m.is_deleted,
          },
          {
            key: "delete-me",
            label: "Delete for me",
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onClick: () => handleDeleteForMe(m),
          },
        ];
        // Suppress when no action survives the visibility filter
        // (e.g. media-only bubble whose only entry would be Copy).
        if (actions.filter((a) => a.visible !== false).length === 0) {
          // unused branch for now since delete-for-me is always
          // visible; kept as a guard for future stages.
          return null;
        }
        // `isMine` referenced for symmetry with later stages (Edit /
        // Delete-for-everyone gate on mine-only). Suppress unused-var
        // warning by reading it.
        void isMine;
        const myReaction = user
          ? (m.reactions || []).find((r) => r.user_id === user.id)
          : undefined;
        return (
          <MessageActionMenu
            anchor={activeMenu.anchor}
            actions={actions}
            onClose={() => setActiveMenu(null)}
            reactionEmojis={REACTION_EMOJIS}
            myEmoji={myReaction?.emoji ?? null}
            onReact={(emoji) => handleToggleReaction(m, emoji)}
          />
        );
      })()}

      {pendingAction && (
        <div
          onClick={() => setPendingAction(null)}
          className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[var(--glass-card-bg)] border border-[var(--glass-border-sm)] shadow-2xl p-5"
          >
            <h3 className="text-base font-semibold text-dark-100 mb-1.5">
              {pendingAction.title}
            </h3>
            <p className="text-sm text-dark-400 mb-5">{pendingAction.body}</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="px-4 h-10 rounded-xl bg-[var(--chat-input-bg)] text-dark-100 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const fn = pendingAction.run;
                  setPendingAction(null);
                  await fn();
                }}
                className={`px-4 h-10 rounded-xl text-white text-sm font-medium ${
                  pendingAction.danger ? "bg-red-600" : "bg-primary-600"
                }`}
              >
                {pendingAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Bubble row wrapper for non-pending, non-failed messages. Owns the
// long-press / right-click / hover-chevron triggers that open the
// MessageActionMenu. Extracted so each row gets its own
// `useLongPress` hook instance (hooks can't be called inside `.map`).
function MessageBubbleWrapper({
  isMine,
  bubbleClass,
  highlighted,
  onOpenMenu,
  onSwipeReply,
  children,
}: {
  isMine: boolean;
  bubbleClass: string;
  highlighted?: boolean;
  onOpenMenu: (anchor: { x: number; y: number }) => void;
  onSwipeReply: () => void;
  children: React.ReactNode;
}) {
  // Long-press → context menu. Swipe (touch only) → trigger reply.
  // The two hooks each return pointer handlers; we compose them so
  // both observe the same gesture sequence. Long-press cancels on
  // ≥8px of movement, so a real swipe never fires the menu.
  const longPress = useLongPress({
    onLongPress: (x, y) => onOpenMenu({ x, y }),
  });
  const swipe = useSwipeToReply({
    direction: isMine ? "left" : "right",
    onCommit: onSwipeReply,
  });
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      longPress.onPointerDown(e);
      swipe.handlers.onPointerDown(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      longPress.onPointerMove(e);
      swipe.handlers.onPointerMove(e);
    },
    onPointerUp: (e: React.PointerEvent) => {
      longPress.onPointerUp(e);
      swipe.handlers.onPointerUp();
    },
    onPointerCancel: (e: React.PointerEvent) => {
      longPress.onPointerCancel();
      swipe.handlers.onPointerCancel();
      void e;
    },
    onPointerLeave: () => {
      longPress.onPointerLeave();
    },
  };
  const dragX = swipe.dragX;
  const swipeProgress = swipe.progress;
  return (
    // Outer wrapper stays still so the reply-icon hint behind the
    // bubble doesn't translate along with the bubble itself. Only the
    // inner bubble div carries the transform. Without this split the
    // icon would never become visible because it would move out of
    // its slot at the same rate as the bubble.
    <div className="relative">
      {/* Reply-icon hint — appears on the side the bubble is moving
          AWAY from as the user drags. Two tiers:
            • below threshold: translucent primary background, growing scale
            • armed (swipeProgress >= 1): solid primary, slight overshoot
          The IIFE keeps the armed flag local to the render block so the
          surrounding wrapper stays a pure layout primitive. */}
      {(() => {
        const armed = swipeProgress >= 1;
        return (
          <div
            aria-hidden
            className={`absolute top-1/2 ${
              isMine ? "right-1" : "left-1"
            } w-9 h-9 rounded-full flex items-center justify-center pointer-events-none ${
              armed
                ? "bg-primary-600 text-white"
                : "bg-primary-500/25 text-primary-300"
            }`}
            style={{
              opacity: swipeProgress,
              // Scale grows linearly 0.5 → 1.0 with progress, then bumps
              // to ~1.15 once armed. The translateY(-50%) keeps it
              // vertically centered (it has top: 50%).
              transform: `translateY(-50%) scale(${
                0.5 + swipeProgress * 0.5 + (armed ? 0.15 : 0)
              })`,
              transition:
                dragX === 0
                  ? "opacity 180ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 150ms, color 150ms"
                  : "background-color 150ms, color 150ms",
            }}
          >
            <ReplyIcon className="w-4 h-4" />
          </div>
        );
      })()}

      <div
        className={`${bubbleClass} relative group ${
          highlighted ? "peja-highlight-flash" : ""
        }`}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenMenu({ x: e.clientX, y: e.clientY });
        }}
        style={{
          transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
          // Snap back smoothly when the gesture ends (dragX = 0). While
          // the user is actively dragging we want the transform to track
          // their finger 1:1, so no transition.
          transition: dragX === 0 ? "transform 200ms ease" : undefined,
          // `touch-action: pan-y` tells the browser: "vertical scrolls
          // are yours, horizontal touches are ours." Without this,
          // Android Chrome (and Capacitor's Chrome-based WebView)
          // grabs the horizontal motion for parent scroll/back-swipe
          // arbitration and cancels our pointer stream mid-gesture —
          // which is exactly the "about to swipe then stops"
          // behaviour. Setting it here scopes the override to the
          // bubble; the surrounding thread can still scroll vertically.
          touchAction: "pan-y",
        }}
        {...handlers}
      >
        {children}
        {/* Desktop-only hover affordance — a chevron in the top-right
            corner that opens the same menu the long-press / right-click
            triggers. Hidden by default and surfaced via `group-hover`,
            so touch devices (which don't fire :hover) never see it. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onOpenMenu({ x: rect.right, y: rect.bottom });
          }}
          className={`absolute top-1.5 ${
            isMine ? "left-1.5" : "right-1.5"
          } w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${
            isMine
              ? "bg-white/25 text-white hover:bg-white/35"
              : "bg-black/15 text-dark-200 hover:bg-black/25"
          }`}
          aria-label="Message options"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// Thumbnail for a File in the to-be-sent row. Builds + revokes its own
// blob URL so the parent doesn't have to manage memory for previews.
// For videos, renders a muted `<video preload="metadata">` so the
// browser pulls the first frame on its own — looks like a real

// Friendly confirm-dialog body for the "you have a pinned message,
// pin a new one?" flow. We surface a short excerpt of each so the
// user knows exactly what they're swapping. Media messages collapse
// to a media-type label since their content is the (often empty)
// caption.
function pinSwapBody(existing: ChatMessage, incoming: ChatMessage): string {
  const exLabel = pinPreviewLabel(existing);
  const inLabel = pinPreviewLabel(incoming);
  return `Unpin "${exLabel}" and pin "${inLabel}" instead?`;
}

function pinPreviewLabel(m: ChatMessage): string {
  const text = (m.content || "").trim();
  if (text) {
    return text.length > 40 ? text.slice(0, 40) + "..." : text;
  }
  if (m.media && m.media.length > 0) {
    const first = m.media[0];
    switch (first.media_type) {
      case "image":
        return "Photo";
      case "video":
        return "Video";
      case "audio":
        return "Voice note";
      case "document":
        return first.file_name || "File";
    }
  }
  return "Message";
}

// Stable color per sender id for the WhatsApp-style sender name
// pill at the top of each group bubble. Pure function of the user
// id so the same person always gets the same colour across renders.
const SENDER_PALETTE = [
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#a78bfa", // violet
  "#f97316", // orange
  "#22c55e", // green
  "#ef4444", // red
  "#3b82f6", // blue
];
function pejaSenderColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return SENDER_PALETTE[h % SENDER_PALETTE.length];
}

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
  const isImage = file.type.startsWith("image/");
  const isDocument = !isImage && !isVideo;
  useEffect(() => {
    // Documents don't need a blob preview — we render an icon + name
    // card instead. Skip the URL.createObjectURL allocation so we
    // don't leak it for files we never display.
    if (isDocument) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isDocument]);
  return (
    <div className="relative shrink-0">
      <div className="w-16 h-16 rounded-xl overflow-hidden bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)]">
        {isDocument ? (
          <div className="w-full h-full flex flex-col items-center justify-center px-1 text-center">
            <FileText className="w-5 h-5 text-dark-300" />
            <span className="text-[9px] text-dark-300 truncate w-full mt-0.5">
              {file.name}
            </span>
          </div>
        ) : url && isVideo ? (
          <video
            src={url}
            muted
            playsInline
            preload="metadata"
            className="w-full h-full object-cover"
          />
        ) : url ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : null}
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
