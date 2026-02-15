"use client";

import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { presenceManager } from "@/lib/presence";
import { notifyDMMessage } from "@/lib/notifications";
import { Skeleton } from "@/components/ui/Skeleton";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { VideoLightbox } from "@/components/ui/VideoLightbox";
import {
  ArrowLeft,
  Send,
  Plus,
  Image as ImageIcon,
  FileText,
  Smile,
  X,
  Crown,
  User,
  Loader2,
  Check,
  CheckCheck,
  Bold,
  Italic,
  List,
  ListOrdered,
  MoreVertical,
  Ban,
  VolumeX,
  Volume2,
  Trash2,
  File as FileIcon,
  Download,
  Copy,
  Pencil,
  Mic,
  Square,
  Info,
  ChevronRight,
  Clock,
  Reply,
} from "lucide-react";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import type { Message, VIPUser, MessageMediaItem } from "@/lib/types";

// =====================================================
// EMOJI DATA
// =====================================================
const EMOJI_TABS = [
  { key: "smileys", label: "😀", emojis: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🫢","🤫","🤔","🫡","🤐","🤨","😐","😑","😶","🫥","😏","😒","🙄","😬","🤥","🫠","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","🫤","😟","🙁","😮","😯","😲","😳","🥺","🥹","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","💩","🤡","👹","👺","👻","👽","👾","🤖"] },
  { key: "gestures", label: "👋", emojis: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","👍","👎","✊","👊","🤛","🤜","👏","🙌","🫶","👐","🤲","🤝","🙏","💪","🦾","🫂","💅","👂","👃","👣","👁️","👀","🧠","🦷","👅","👄"] },
  { key: "hearts", label: "❤️", emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","🩷","🩵","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞","💓","💗","💖","💘","💝","💟","💋","💌","💐","🌹","🥀","💍","💒"] },
  { key: "animals", label: "🐶", emojis: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐔","🐧","🐦","🦆","🦅","🦉","🦇","🐺","🐴","🦄","🐝","🦋","🐌","🐞","🐜","🐢","🐍","🦎","🦖","🐙","🦑","🐬","🐳","🦈","🐊","🐘","🦏","🐪","🦒","🐕","🐈","🐇","🦔","🐾","🐉"] },
  { key: "food", label: "🍕", emojis: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🥑","🥦","🌽","🥕","🥐","🍞","🧀","🥚","🍳","🥞","🥓","🥩","🍗","🌭","🍔","🍟","🍕","🥪","🌮","🌯","🥘","🍲","🍣","🍤","🍦","🍩","🎂","🍰","🍫","🍬","🍭","☕","🍵","🥤","🍺","🍷","🍸","🍹"] },
  { key: "activities", label: "⚽", emojis: ["⚽","🏀","🏈","⚾","🎾","🏐","🎱","🏓","🏸","🥊","🎽","🛹","⛸️","🎿","🏂","🏋️","🤸","🏄","🏊","🚴","🎪","🎭","🎨","🎬","🎤","🎧","🎼","🎹","🎷","🎸","🎻","🎲","🎯","🎳","🎮","🕹️","🧩","🎰","🎁","🏆","🥇","🥈","🥉","🎃","🎊","🎉"] },
  { key: "travel", label: "🚗", emojis: ["🚗","🚕","🚙","🚌","🏎️","🚓","🚑","🚒","🚐","🚚","🚜","🏍️","🛵","🚲","🚁","✈️","🛩️","🚀","🛸","⛵","🚤","🛳️","🚢","🚂","🚄","🚅","🚇","🗼","🗽","🏛️","🏰","🏟️","🎡","🎢","⛲","🏖️","🏜️","🌋","🏔️","🏕️","🏠","🏢","🏥","⛪","🕌"] },
  { key: "symbols", label: "⭐", emojis: ["⭐","🌟","💫","✨","🔥","💯","✅","❌","⚠️","🚀","💎","🎉","🏆","🎯","💡","🔔","🔒","🔑","💰","📍","⚡","🌍","📱","💻","📸","🎵","📧","📎","✏️","📝","📊","🛡️","♻️","☮️","♾️","⬆️","➡️","⬇️","⬅️","↩️","🔄","❗","❓","💤"] },
  { key: "kaomoji", label: "ツ", emojis: ["ʕ•ᴥ•ʔ","(╯°□°)╯︵ ┻━┻","┬─┬ノ( º _ ºノ)","(☞ﾟヮﾟ)☞","( ͡° ͜ʖ ͡°)","ಠ_ಠ","ಠ‿ಠ","(ง'̀-'́)ง","(づ｡◕‿‿◕｡)づ","¯\\_(ツ)_/¯","(⌐■_■)","༼ つ ◕_◕ ༽つ","(◕‿◕✿)","ヽ(´▽`)/","(*≧ω≦)","(╥_╥)","(✿◠‿◠)","٩(◕‿◕｡)۶","( ˘ ³˘)♥","OwO","UwU",">_<","^_^","T_T","-_-","O_O","=^.^=","★彡","♪♫♬","→_→","←_←","◉_◉","꒰ᐢ. ̫ .ᐢ꒱","₍ᐢ..ᐢ₎","𓃠","𓆏","𓃰"] },
];

// =====================================================
// REACTION EMOJIS (quick reactions like WhatsApp)
// =====================================================
const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🙏", "👍"];

// =====================================================
// DOCUMENT ICON HELPER
// =====================================================
function getDocIcon(fileName: string | null): string {
  if (!fileName) return "📄";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "📕", doc: "📘", docx: "📘", txt: "📝", xlsx: "📊",
    xls: "📊", pptx: "📙", ppt: "📙", zip: "📦", rar: "📦",
  };
  return map[ext] || "📄";
}

// =====================================================
// MAIN COMPONENT
// =====================================================
export default function ChatPage() {
  const params = useParams();
  const conversationId = params.id as string;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const MSG_CACHE_KEY = `peja-chat-cache-${conversationId}`;

  // ------ Core State ------
  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<VIPUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // ------ Input State ------
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiTab, setEmojiTab] = useState("smileys");
  const [showAttach, setShowAttach] = useState(false);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");

  // ------ UI State ------
  const [showMenu, setShowMenu] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [otherUserOnline, setOtherUserOnline] = useState(false);
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null);
  const [pendingMedia, setPendingMedia] = useState<{ file: File; preview: string; type: string }[]>([]);

  // ------ Long Press / Context Menu ------
  const [contextMenuMsg, setContextMenuMsg] = useState<Message | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [reactionPickerTab, setReactionPickerTab] = useState("smileys");

  // ------ Edit Mode ------
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  // ------ Reply Mode ------
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);

  // ------ Lightbox ------
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxVideo, setLightboxVideo] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // ------ Voice Note ------
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  // ------ Swipe to Reply ------
  const [swipingMsgId, setSwipingMsgId] = useState<string | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const swipeStartRef = useRef<{ x: number; y: number; locked: boolean } | null>(null);

  // ------ Refs ------
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);
  const presenceChannelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialScrollDone = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const myDeletionsRef = useRef<Set<string>>(new Set());
  const otherUserOnlineRef = useRef(false);

  // Reset scroll flag when conversation changes
  useEffect(() => {
    initialScrollDone.current = false;
  }, [conversationId]);

  // =====================================================
  // AUTH GUARD
  // =====================================================
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    if (user.is_vip === false) { router.replace("/"); return; }
  }, [user, authLoading, router]);

  // =====================================================
  // FETCH CONVERSATION DATA
  // =====================================================
  useEffect(() => {
    if (!user?.id || !conversationId) return;

    const fetchData = async () => {
      // Restore cached messages immediately
try {
  const cached = sessionStorage.getItem(MSG_CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed) && parsed.length > 0) {
      setMessages(parsed);
      setLoading(false);
    }
  }
} catch {}
      try {
        const { data: participants, error: pErr } = await supabase
          .from("conversation_participants")
          .select("user_id, is_muted, is_blocked, last_read_at")
          .eq("conversation_id", conversationId);
        if (pErr) throw pErr;

        const myP = participants?.find((p) => p.user_id === user.id);
        const otherP = participants?.find((p) => p.user_id !== user.id);
        if (!otherP) { router.replace("/messages"); return; }

        setIsMuted(myP?.is_muted || false);
        setIsBlocked(myP?.is_blocked || false);

        // Store other user's last_read_at for seen status
        const otherReadAt = otherP.last_read_at || null;
        setOtherLastReadAt(otherReadAt);

        const { data: otherUserData, error: uErr } = await supabase
          .from("users")
          .select("id, full_name, email, avatar_url, is_vip, is_admin, is_guardian, last_seen_at, status")
          .eq("id", otherP.user_id)
          .single();
        if (uErr) throw uErr;

        const otherVIP = otherUserData as VIPUser;
        otherVIP.is_online = presenceManager.isOnline(otherVIP.id);
        setOtherUser(otherVIP);
        setOtherUserOnline(presenceManager.isOnline(otherVIP.id));

        const { data: myDeletions } = await supabase
          .from("message_deletions")
          .select("message_id")
          .eq("user_id", user.id);
        myDeletionsRef.current = new Set((myDeletions || []).map((d: any) => d.message_id));

        // Pass otherReadAt directly — don't rely on state
        await fetchMessages(otherReadAt);
        await markAsRead();
        // Store for optimistic unread clear when going back
        try { sessionStorage.setItem("peja-last-chat-id", conversationId); } catch {}
      } catch (e: any) {
        console.error("Chat fetch error:", e?.message || e);
        router.replace("/messages");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.id, conversationId]);

  // =====================================================
  // PRESENCE: Watch other user's online status
  // =====================================================
  useEffect(() => {
    if (!otherUser?.id) return;

    const checkOnline = (lastSeen?: string | null) => {
      if (presenceManager.isOnline(otherUser.id)) return true;
      const ls = lastSeen ?? otherUser.last_seen_at;
      if (ls) {
        const diff = Date.now() - new Date(ls).getTime();
        if (diff < 2 * 60 * 1000) return true;
      }
      return false;
    };

    const online = checkOnline();
    setOtherUserOnline(online);
    otherUserOnlineRef.current = online;

    // Subscribe to real-time presence changes
    const unsub = presenceManager.onStatusChange((userId, isOnline) => {
      if (userId === otherUser.id) {
        setOtherUserOnline(isOnline);
        otherUserOnlineRef.current = isOnline;
      }
    });

    // Poll last_seen_at from DB every 30s as fallback
    const pollLastSeen = async () => {
      const { data } = await supabase
        .from("users")
        .select("last_seen_at")
        .eq("id", otherUser.id)
        .single();

      if (data?.last_seen_at) {
        const nowOnline = checkOnline(data.last_seen_at);
        setOtherUserOnline(nowOnline);
        otherUserOnlineRef.current = nowOnline;
      }
    };

    const initialTimer = setTimeout(pollLastSeen, 1000);
    const pollInterval = setInterval(pollLastSeen, 30000);

    return () => {
      unsub();
      clearTimeout(initialTimer);
      clearInterval(pollInterval);
    };
  }, [otherUser?.id]);

  // =====================================================
  // FETCH MESSAGES
  // =====================================================
   const fetchMessages = useCallback(async (otherReadAt?: string | null) => {
    if (!user?.id) return;

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) { console.error("Messages fetch:", error.message); return; }

    const msgs = (data || []) as Message[];

    // Fetch media for media/document messages
    const mediaIds = msgs
      .filter((m) => m.content_type === "media" || m.content_type === "document")
      .map((m) => m.id);
    let mediaMap: Record<string, MessageMediaItem[]> = {};
    if (mediaIds.length > 0) {
      const { data: md } = await supabase
        .from("message_media")
        .select("*")
        .in("message_id", mediaIds);
      (md || []).forEach((m: any) => {
        if (!mediaMap[m.message_id]) mediaMap[m.message_id] = [];
        mediaMap[m.message_id].push(m);
      });
    }

    // Fetch read receipts for own messages
    const ownIds = msgs.filter((m) => m.sender_id === user.id).map((m) => m.id);
    let readMap: Record<string, string | null> = {};
    if (ownIds.length > 0) {
      const { data: rd } = await supabase
        .from("message_reads")
        .select("message_id, read_at")
        .in("message_id", ownIds)
        .neq("user_id", user.id);
      (rd || []).forEach((r: any) => {
        readMap[r.message_id] = r.read_at;
      });
    }

    // Fetch reactions
    const allIds = msgs.map((m) => m.id);
    let reactionsMap: Record<string, any[]> = {};
    if (allIds.length > 0) {
      const { data: reactions } = await supabase
        .from("message_reactions")
        .select("*")
        .in("message_id", allIds);
      (reactions || []).forEach((r: any) => {
        if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
        reactionsMap[r.message_id].push(r);
      });
    }

    // Fetch reply-to messages
    const replyIds = msgs.filter((m) => m.reply_to_id).map((m) => m.reply_to_id!);
    let replyMap: Record<string, Message> = {};
    if (replyIds.length > 0) {
      const { data: replies } = await supabase
        .from("messages")
        .select("*")
        .in("id", replyIds);
      (replies || []).forEach((r: any) => {
        replyMap[r.id] = r;
      });
    }

    const deletedForMe = myDeletionsRef.current;

    setMessages(
      msgs
        .filter((m) => !deletedForMe.has(m.id))
        .map((m) => {
          let deliveryStatus: "sent" | "seen" | undefined;
          if (m.sender_id === user.id) {
            if (readMap[m.id]) {
              deliveryStatus = "seen";
            } else if (otherReadAt && new Date(otherReadAt) >= new Date(m.created_at)) {
              deliveryStatus = "seen";
            } else {
              deliveryStatus = "sent";
            }
          }
          return {
            ...m,
            media: mediaMap[m.id] || [],
            delivery_status: deliveryStatus,
            read_at: m.sender_id === user.id ? readMap[m.id] || null : null,
            hidden_for_me: false,
            reactions: reactionsMap[m.id] || [],
            reply_to: m.reply_to_id ? replyMap[m.reply_to_id] || null : null,
          };
        })
    );
    // Cache messages
try {
  const cacheData = msgs
    .filter((m) => !deletedForMe.has(m.id))
    .map((m) => ({
      ...m,
      media: mediaMap[m.id] || [],
      reactions: reactionsMap[m.id] || [],
      reply_to: m.reply_to_id ? replyMap[m.reply_to_id] || null : null,
    }));
  sessionStorage.setItem(`peja-chat-cache-${conversationId}`, JSON.stringify(cacheData.slice(-100)));
} catch {}
  }, [user?.id, conversationId]);

  // =====================================================
  // MARK AS READ
  // =====================================================
  const markAsRead = useCallback(async () => {
    if (!user?.id) return;
    try {
      await supabase
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id);

      const { data: unread } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .neq("sender_id", user.id)
        .eq("is_deleted", false);

      if (unread && unread.length > 0) {
        await supabase.from("message_reads").upsert(
          unread.map((m) => ({
            message_id: m.id,
            user_id: user.id,
            read_at: new Date().toISOString(),
          })),
          { onConflict: "message_id,user_id" }
        );
      }
    } catch {}
  }, [user?.id, conversationId]);

  // =====================================================
  // SCROLL TO BOTTOM
  // =====================================================
  const scrollToBottom = useCallback((instant = true) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (instant) {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
  const container = messagesContainerRef.current;
  if (!container) return;

  const el = container.querySelector(`[data-msg-id="${messageId}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMsgId(messageId);
    setTimeout(() => setHighlightedMsgId(null), 2000);
  }
}, []);

  useEffect(() => {
    if (messages.length === 0) return;

    if (!initialScrollDone.current) {
      // Multiple attempts for async image/media loading
      scrollToBottom(true);
      requestAnimationFrame(() => scrollToBottom(true));
      setTimeout(() => scrollToBottom(true), 100);
      setTimeout(() => scrollToBottom(true), 300);
      setTimeout(() => scrollToBottom(true), 600);
      initialScrollDone.current = true;
    } else {
      // Auto-scroll only if user is near bottom
      const c = messagesContainerRef.current;
      if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 150) {
        scrollToBottom(false);
      }
    }
  }, [messages, scrollToBottom]);

  // Scroll when loading finishes
  useEffect(() => {
    if (!loading && messages.length > 0) {
      setTimeout(() => scrollToBottom(true), 50);
    }
  }, [loading, scrollToBottom]);

  // =====================================================
  // ANDROID KEYBOARD: adjust layout when keyboard opens
  // =====================================================
  useEffect(() => {
    if (typeof window === "undefined") return;

    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => {
      const keyboardHeight = window.innerHeight - vv.height;
      const offset = Math.max(keyboardHeight, 0);
      document.documentElement.style.setProperty("--keyboard-height", `${offset}px`);

      // Scroll to bottom when keyboard opens
      if (offset > 100) {
        setTimeout(() => scrollToBottom(false), 150);
      }
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);

    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      document.documentElement.style.setProperty("--keyboard-height", "0px");
    };
  }, [scrollToBottom]);

  // Non-passive touch move to allow preventDefault during swipe
useEffect(() => {
  const container = messagesContainerRef.current;
  if (!container) return;

  const handler = (e: TouchEvent) => {
    // Only prevent default if we're actively swiping
    if (swipingMsgId && swipeX > 5) {
      e.preventDefault();
    }
  };

  container.addEventListener("touchmove", handler, { passive: false });
  return () => container.removeEventListener("touchmove", handler);
}, [swipingMsgId, swipeX]);

  // =====================================================
  // REALTIME: Messages + Read receipts + Reactions
  // =====================================================
  useEffect(() => {
    if (!user?.id || !conversationId) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`chat-rt-${conversationId}-${Date.now()}`)
      // New messages
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          const newMsg = payload.new as Message;
          if (myDeletionsRef.current.has(newMsg.id)) return;

          let media: MessageMediaItem[] = [];
          if (newMsg.content_type === "media" || newMsg.content_type === "document") {
            await new Promise((r) => setTimeout(r, 500));
            const { data } = await supabase
              .from("message_media")
              .select("*")
              .eq("message_id", newMsg.id);
            media = (data || []) as MessageMediaItem[];
          }

          // Fetch reply_to if present
          let replyTo: Message | null = null;
          if (newMsg.reply_to_id) {
            const { data: replyData } = await supabase
              .from("messages")
              .select("*")
              .eq("id", newMsg.reply_to_id)
              .single();
            if (replyData) replyTo = replyData as Message;
          }

          setMessages((prev) => {
            const existing = prev.find((m) => m.id === newMsg.id);
            if (existing) {
              return prev.map((m) =>
                m.id === newMsg.id
                  ? { ...m, media: media.length > 0 ? media : m.media }
                  : m
              );
            }
            return [
              ...prev,
              {
                ...newMsg,
                media,
                delivery_status: newMsg.sender_id === user.id ? ("sent" as const) : undefined,
                reactions: [],
                reply_to: replyTo,
              },
            ];
          });

          // If we received a message from the other user, mark as read
          // This also triggers a message_reads INSERT which the sender will pick up
          if (newMsg.sender_id !== user.id) markAsRead();
        }
      )
      // Message updates (edits, deletions)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const u = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === u.id
                ? {
                    ...m,
                    is_deleted: u.is_deleted,
                    content: u.content,
                    edited_at: u.edited_at,
                    content_type: u.content_type,
                  }
                : m
            )
          );
        }
      )
      // Read receipts — listen to ALL inserts on message_reads
      // and filter client-side for this conversation's messages
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reads" },
        (payload) => {
          const read = payload.new as any;
          // Only care about reads from the OTHER user (meaning they read OUR messages)
          if (read.user_id === user.id) return;

          setMessages((prev) => {
            // Check if this read receipt is for a message in our conversation
            const msgExists = prev.some((m) => m.id === read.message_id);
            if (!msgExists) return prev;

            return prev.map((m) =>
              m.id === read.message_id && m.sender_id === user.id
                ? { ...m, delivery_status: "seen" as const, read_at: read.read_at }
                : m
            );
          });
        }
      )
      // Reactions
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        async (payload) => {
          // Quick check: is this reaction for a message in our view?
          const reactionData = (payload.new || payload.old) as any;
          if (!reactionData?.message_id) return;

          setMessages((prev) => {
            const msgExists = prev.some((m) => m.id === reactionData.message_id);
            if (!msgExists) return prev;

            // Refetch reactions for this specific message
            supabase
              .from("message_reactions")
              .select("*")
              .eq("message_id", reactionData.message_id)
              .then(({ data: reactions }) => {
                setMessages((p) =>
                  p.map((m) =>
                    m.id === reactionData.message_id
                      ? { ...m, reactions: reactions || [] }
                      : m
                  )
                );
              });

            return prev;
          });
        }
      )
      // Listen for participant updates (last_read_at changes = seen status)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_participants", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const updated = payload.new as any;
          // If the OTHER user updated their last_read_at, update seen statuses
          if (updated.user_id !== user.id && updated.last_read_at) {
            setOtherLastReadAt(updated.last_read_at);
            setMessages((prev) =>
              prev.map((m) => {
                if (m.sender_id !== user.id) return m;
                if (m.delivery_status === "seen") return m;
                if (new Date(updated.last_read_at) >= new Date(m.created_at)) {
                  return { ...m, delivery_status: "seen" as const };
                }
                return m;
              })
            );
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, conversationId, markAsRead]);

  // =====================================================
  // POLLING FALLBACK: Check read status every 5s
  // =====================================================
  useEffect(() => {
    if (!user?.id || !conversationId) return;

    const checkReadStatus = async () => {
      // Fetch other user's last_read_at
      const { data: otherP } = await supabase
        .from("conversation_participants")
        .select("last_read_at, user_id")
        .eq("conversation_id", conversationId)
        .neq("user_id", user.id)
        .single();

      if (otherP?.last_read_at) {
        const newLastRead = otherP.last_read_at;
        setOtherLastReadAt((prev) => {
          if (prev === newLastRead) return prev;
          // Update message statuses based on new last_read_at
          setMessages((msgs) =>
            msgs.map((m) => {
              if (m.sender_id !== user.id) return m;
              if (m.delivery_status === "seen") return m;
              if (new Date(newLastRead) >= new Date(m.created_at)) {
                return { ...m, delivery_status: "seen" as const };
              }
              return m;
            })
          );
          return newLastRead;
        });
      }
    };

    // Check after a short delay (let markAsRead from other side propagate)
    setTimeout(checkReadStatus, 2000);

    const interval = setInterval(checkReadStatus, 5000);
    return () => clearInterval(interval);
  }, [user?.id, conversationId]);

  // =====================================================
  // TYPING INDICATOR
  // =====================================================
  useEffect(() => {
    if (!user?.id || !conversationId) return;

    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current);
      presenceChannelRef.current = null;
    }

    const channel = supabase.channel(`typing-${conversationId}`, {
      config: { presence: { key: user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setTypingUsers(
          Object.keys(state).filter((id) => {
            if (id === user.id) return false;
            return (state[id] as any[]).some((p) => p.typing);
          })
        );
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ typing: false });
      });

    presenceChannelRef.current = channel;

    return () => {
      if (presenceChannelRef.current) {
        supabase.removeChannel(presenceChannelRef.current);
        presenceChannelRef.current = null;
      }
    };
  }, [user?.id, conversationId]);

  const sendTyping = useCallback(() => {
    if (!presenceChannelRef.current) return;
    presenceChannelRef.current.track({ typing: true });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      presenceChannelRef.current?.track({ typing: false });
    }, 2000);
  }, []);

  // =====================================================
  // EDITOR HELPERS
  // =====================================================
  const getEditorContent = useCallback((): string => {
    const el = editorRef.current;
    if (!el) return "";
    return el.innerText.trim();
  }, []);

  const getEditorHTML = useCallback((): string => {
    const el = editorRef.current;
    if (!el) return "";
    return el.innerHTML;
  }, []);

  const clearEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = "";
  }, []);

  const isEditorEmpty = useCallback((): boolean => {
    const el = editorRef.current;
    if (!el) return true;
    return el.innerText.trim().length === 0;
  }, []);

  // =====================================================
  // RENDER MESSAGE CONTENT
  // =====================================================
  const renderContent = useCallback((content: string | null) => {
    if (!content) return null;

    let html = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    html = html.replace(
      /`(.*?)`/g,
      '<code class="px-1 py-0.5 rounded bg-white/10 text-xs font-mono">$1</code>'
    );
    html = html.replace(
      /(?<!href=["'])(?<!>)(https?:\/\/[^\s<)]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary-400 underline hover:text-primary-300 break-all">$1</a>'
    );
    html = html.replace(
      /^[-•]\s+(.+)$/gm,
      '<div class="flex gap-2 items-start"><span class="text-primary-400 mt-0.5">•</span><span>$1</span></div>'
    );
    html = html.replace(
      /^(\d+)\.\s+(.+)$/gm,
      '<div class="flex gap-2 items-start"><span class="text-primary-400 font-medium min-w-[1.2em]">$1.</span><span>$2</span></div>'
    );

    return (
      <div
        className="text-sm whitespace-pre-wrap break-words leading-relaxed [&_a]:text-primary-400 [&_a]:underline [&_strong]:font-bold [&_em]:italic"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }, []);

  // =====================================================
  // HTML TO MARKDOWN
  // =====================================================
  const htmlToMarkdown = useCallback((html: string): string => {
    const div = document.createElement("div");
    div.innerHTML = html;

    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";

      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const childText = Array.from(el.childNodes).map(walk).join("");

      switch (tag) {
        case "b": case "strong": return `**${childText}**`;
        case "i": case "em": return `*${childText}*`;
        case "a": {
          const href = el.getAttribute("href");
          if (href && childText && childText !== href) return `${childText} (${href})`;
          return href || childText;
        }
        case "br": return "\n";
        case "div": case "p": return childText + "\n";
        case "ul": case "ol": return childText;
        case "li": {
          const parent = el.parentElement;
          if (parent?.tagName.toLowerCase() === "ol") {
            const idx = Array.from(parent.children).indexOf(el) + 1;
            return `${idx}. ${childText}\n`;
          }
          return `- ${childText}\n`;
        }
        default: return childText;
      }
    };

    return walk(div).replace(/\n{3,}/g, "\n\n").trim();
  }, []);

  // =====================================================
  // SEND MESSAGE
  // =====================================================
  const handleSend = useCallback(async () => {
    const textContent = getEditorContent();
    if ((!textContent && pendingMedia.length === 0) || sending || !user?.id) return;

    // Check if blocked by the other user
    if (otherUser?.id) {
      const { data: blocked } = await supabase
        .from("dm_blocks")
        .select("id")
        .eq("blocker_id", otherUser.id)
        .eq("blocked_id", user.id)
        .maybeSingle();
      if (blocked) {
        toast.warning("You have been blocked by this user");
        return;
      }
    }

    setSending(true);
    try {
      let contentType = "text";
      let mediaItems: { url: string; media_type: string; file_name: string; file_size: number }[] = [];

      if (pendingMedia.length > 0) {
        contentType = pendingMedia.some(
          (m) => m.type.startsWith("image/") || m.type.startsWith("video/")
        )
          ? "media"
          : "document";

        // Check if any are audio — if ALL are audio, use media type
        if (pendingMedia.every((m) => m.type.startsWith("audio/"))) {
          contentType = "media";
        }

        for (const media of pendingMedia) {
          const ext = media.file.name.split(".").pop() || "file";
          const path = `messages/${conversationId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from("message-media")
            .upload(path, media.file);
          if (uploadError) { console.error("Upload error:", uploadError); continue; }

          const { data: urlData } = supabase.storage
            .from("message-media")
            .getPublicUrl(path);

          let mediaType = "document";
          if (media.type.startsWith("image/")) mediaType = "image";
          else if (media.type.startsWith("video/")) mediaType = "video";
          else if (media.type.startsWith("audio/")) mediaType = "audio";

          mediaItems.push({
            url: urlData.publicUrl,
            media_type: mediaType,
            file_name: media.file.name,
            file_size: media.file.size,
          });
        }
      }

      const editorHTML = getEditorHTML();
      const markdownContent = editorHTML ? htmlToMarkdown(editorHTML) : null;

      const messageData: any = {
        conversation_id: conversationId,
        sender_id: user.id,
        content: markdownContent || null,
        content_type: contentType,
        reply_to_id: replyingTo?.id || null,
      };

      // If editing, update instead
      if (editingMessage) {
        const { error: editErr } = await supabase
          .from("messages")
          .update({
            content: markdownContent,
            edited_at: new Date().toISOString(),
          })
          .eq("id", editingMessage.id)
          .eq("sender_id", user.id);

        if (editErr) throw editErr;

        setEditingMessage(null);
        clearEditor();
        setSending(false);
        return;
      }

      const { data: newMsg, error: msgError } = await supabase
        .from("messages")
        .insert(messageData)
        .select()
        .single();
      if (msgError) throw msgError;

      if (mediaItems.length > 0 && newMsg) {
        await supabase.from("message_media").insert(
          mediaItems.map((m) => ({ message_id: newMsg.id, ...m }))
        );
      }

      // Optimistically add message
      if (newMsg) {
        const localMedia: MessageMediaItem[] = mediaItems.map((m, i) => ({
          id: `temp-${i}-${Date.now()}`,
          message_id: newMsg.id,
          url: m.url,
          media_type: m.media_type as "image" | "video" | "document" | "audio",
          file_name: m.file_name,
          file_size: m.file_size,
          mime_type: null,
          thumbnail_url: null,
          created_at: new Date().toISOString(),
        }));

        setMessages((prev) => {
          if (prev.some((msg) => msg.id === newMsg.id)) return prev;
          return [
            ...prev,
            {
              ...newMsg,
              media: localMedia,
              delivery_status: "sent" as const,
              read_at: null,
              hidden_for_me: false,
              reactions: [],
              reply_to: replyingTo || null,
            },
          ];
        });
      }

      await supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          last_message_text: markdownContent?.slice(0, 100) || (mediaItems.length > 0 ? "Sent an attachment" : null),
          last_message_sender_id: user.id,
        })
        .eq("id", conversationId);

      if (otherUser) {
        notifyDMMessage(
          otherUser.id,
          user.full_name || "Someone",
          markdownContent || "Sent an attachment",
          conversationId
        );
      }

      clearEditor();
      setPendingMedia([]);
      setReplyingTo(null);
    } catch (e: any) {
      console.error("Send error:", e?.message || e);
      toast.danger("Failed to send message");
    } finally {
      setSending(false);
    }
  }, [
    getEditorContent, getEditorHTML, htmlToMarkdown, pendingMedia,
    sending, user, conversationId, otherUser, editingMessage, replyingTo,
    clearEditor, toast, markAsRead,
  ]);

  // =====================================================
  // FORMAT COMMANDS
  // =====================================================
  const applyBold = () => { document.execCommand("bold"); editorRef.current?.focus(); };
  const applyItalic = () => { document.execCommand("italic"); editorRef.current?.focus(); };
  const applyBulletList = () => { document.execCommand("insertUnorderedList"); editorRef.current?.focus(); };
  const applyNumberedList = () => { document.execCommand("insertOrderedList"); editorRef.current?.focus(); };

  const openLinkInput = () => {
    const selection = window.getSelection();
    if (selection && selection.toString()) setLinkText(selection.toString());
    setShowLinkInput(true);
  };

  const insertLink = () => {
    if (!linkUrl.trim()) return;
    const url = linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
    const displayText = linkText || url;
    const editor = editorRef.current;
    if (editor) {
      editor.focus();
      setTimeout(() => {
        const linkHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary-400 underline">${displayText}</a>&nbsp;`;
        document.execCommand("insertHTML", false, linkHTML);
      }, 50);
    }
    setShowLinkInput(false);
    setLinkUrl("");
    setLinkText("");
  };

  // =====================================================
  // FILE HANDLING
  // =====================================================
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newMedia: { file: File; preview: string; type: string }[] = [];
    Array.from(files).forEach((file) => {
      if (file.size > 50 * 1024 * 1024) {
        toast.warning("File too large. Max 50MB.");
        return;
      }
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
      newMedia.push({ file, preview, type: file.type });
    });

    setPendingMedia((prev) => [...prev, ...newMedia].slice(0, 5));
    setShowAttach(false);
    e.target.value = "";
  };

  const removePendingMedia = (index: number) => {
    setPendingMedia((prev) => {
      const copy = [...prev];
      if (copy[index]?.preview) URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
  };

  // =====================================================
  // VOICE NOTE
  // =====================================================
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const recordedMimeType = mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: recordedMimeType });
        const ext = recordedMimeType.includes("webm") ? "webm" : "m4a";
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: recordedMimeType });
        setPendingMedia((prev) => [...prev, { file, preview: "", type: recorder.mimeType }]);

        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
          recordingIntervalRef.current = null;
        }
        setRecordingDuration(0);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingDuration(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (e: any) {
      console.error("Recording error:", e);
      toast.danger("Could not access microphone");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // =====================================================
  // REACTIONS
  // =====================================================
  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user?.id) return;

    try {
      // Check if reaction already exists
      const { data: existing } = await supabase
        .from("message_reactions")
        .select("id")
        .eq("message_id", messageId)
        .eq("user_id", user.id)
        .eq("emoji", emoji)
        .maybeSingle();

      if (existing) {
        // Remove reaction
        await supabase.from("message_reactions").delete().eq("id", existing.id);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, reactions: (m.reactions || []).filter((r) => r.id !== existing.id) }
              : m
          )
        );
      } else {
        // Add reaction
        const { data: newReaction } = await supabase
          .from("message_reactions")
          .insert({ message_id: messageId, user_id: user.id, emoji })
          .select()
          .single();

        if (newReaction) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, reactions: [...(m.reactions || []), newReaction] }
                : m
            )
          );
        }
      }
    } catch {
      toast.danger("Failed to react");
    }
    setContextMenuMsg(null);
  };

  // =====================================================
  // DELETE / EDIT / COPY / REPLY
  // =====================================================
  const handleDeleteForEveryone = async (messageId: string) => {
    try {
      await supabase
        .from("messages")
        .update({ is_deleted: true, content: null })
        .eq("id", messageId)
        .eq("sender_id", user?.id || "");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, is_deleted: true, content: null } : m
        )
      );
    } catch {
      toast.danger("Failed to delete message");
    }
    setContextMenuMsg(null);
  };

  const handleDeleteForMe = async (messageId: string) => {
    try {
      await supabase.from("message_deletions").insert({
        message_id: messageId,
        user_id: user?.id,
      });
      myDeletionsRef.current.add(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch {
      toast.danger("Failed to delete message");
    }
    setContextMenuMsg(null);
  };

  const handleCopy = (content: string | null) => {
    if (!content) return;
    const clean = content
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`(.*?)`/g, "$1");
    navigator.clipboard.writeText(clean).then(() => {
      toast.info("Copied to clipboard");
    });
    setContextMenuMsg(null);
  };

  const handleEdit = (msg: Message) => {
    setEditingMessage(msg);
    setTimeout(() => {
      if (editorRef.current && msg.content) {
        editorRef.current.innerText = msg.content
          .replace(/\*\*(.*?)\*\*/g, "$1")
          .replace(/\*(.*?)\*/g, "$1");
        editorRef.current.focus();
      }
    }, 50);
    setContextMenuMsg(null);
  };

  const handleReply = (msg: Message) => {
    setReplyingTo(msg);
    setContextMenuMsg(null);
    setTimeout(() => editorRef.current?.focus(), 100);
  };

  // =====================================================
  // MUTE / BLOCK
  // =====================================================
  const toggleMute = async () => {
    const newVal = !isMuted;
    setIsMuted(newVal);
    setShowMenu(false);
    await supabase
      .from("conversation_participants")
      .update({ is_muted: newVal })
      .eq("conversation_id", conversationId)
      .eq("user_id", user?.id || "");
    toast.info(newVal ? "Conversation muted" : "Conversation unmuted");
  };

  const toggleBlock = async () => {
    if (!otherUser?.id || !user?.id) return;
    setShowMenu(false);

    if (isBlocked) {
      await supabase.from("dm_blocks").delete()
        .eq("blocker_id", user.id).eq("blocked_id", otherUser.id);
      await supabase.from("conversation_participants")
        .update({ is_blocked: false })
        .eq("conversation_id", conversationId).eq("user_id", user.id);
      setIsBlocked(false);
      toast.info("User unblocked");
    } else {
      await supabase.from("dm_blocks").insert({
        blocker_id: user.id, blocked_id: otherUser.id,
      });
      await supabase.from("conversation_participants")
        .update({ is_blocked: true })
        .eq("conversation_id", conversationId).eq("user_id", user.id);
      setIsBlocked(true);
      toast.warning("User blocked");
    }
  };

  const deleteChat = async () => {
    if (!user?.id) return;
    try {
      const { data: allMsgs } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId);

      if (allMsgs && allMsgs.length > 0) {
        const deletions = allMsgs.map((m) => ({
          message_id: m.id,
          user_id: user.id,
        }));
        await supabase.from("message_deletions").upsert(deletions, {
          onConflict: "message_id,user_id",
        });
      }

      toast.info("Chat cleared");
      setMessages([]);
      setShowChatInfo(false);
    } catch {
      toast.danger("Failed to clear chat");
    }
  };

  // =====================================================
  // LONG PRESS HANDLER
  // =====================================================
  const handleTouchStart = (msg: Message, e: React.TouchEvent | React.MouseEvent) => {
    if (msg.is_deleted) return;

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    longPressTimerRef.current = setTimeout(() => {
      setContextMenuMsg(msg);
      setContextMenuPos({ x: clientX, y: clientY });
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // =====================================================
  // SWIPE TO REPLY
  // =====================================================
  const handleSwipeStart = (msgId: string, e: React.TouchEvent) => {
    const touch = e.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, locked: false };
    setSwipingMsgId(msgId);
  };

const handleSwipeMove = (msg: Message, e: React.TouchEvent) => {
  if (!swipeStartRef.current || msg.is_deleted) return;
  const touch = e.touches[0];
  const dx = touch.clientX - swipeStartRef.current.x;
  const dy = touch.clientY - swipeStartRef.current.y;

  // Determine if horizontal or vertical swipe
  if (!swipeStartRef.current.locked) {
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      swipeStartRef.current.locked = true;
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical scroll — cancel swipe
        swipeStartRef.current = null;
        setSwipingMsgId(null);
        setSwipeX(0);
        return;
      }
    } else {
      return;
    }
  }

  const isMine = msg.sender_id === user?.id;

  // Own messages: swipe LEFT (negative dx → positive swipeX)
  // Other messages: swipe RIGHT (positive dx → positive swipeX)
  const raw = isMine ? -dx : dx;
  const clamped = Math.max(0, Math.min(raw, 80));
  setSwipeX(clamped);

  // Prevent page scroll while swiping horizontally
  if (clamped > 5) {
    e.preventDefault();
  }

  // Cancel long press if swiping
  if (clamped > 10 && longPressTimerRef.current) {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }
};

  const handleSwipeEnd = (msg: Message) => {
    if (swipeX > 60) {
      // Trigger reply
      handleReply(msg);
    }
    setSwipeX(0);
    setSwipingMsgId(null);
    swipeStartRef.current = null;
  };

  // =====================================================
  // DATE SEPARATOR
  // =====================================================
  const getDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMM d, yyyy");
  };

  // =====================================================
  // DELIVERY STATUS DISPLAY
  // =====================================================
  const DeliveryLabel = ({ status }: { status?: "sent" | "seen" }) => {
    if (!status) return null;
    if (status === "seen") {
      return (
        <span className="text-[10px] text-purple-400 font-medium drop-shadow-[0_0_4px_rgba(168,85,247,0.6)]">
          Seen
        </span>
      );
    }
    return <span className="text-[10px] text-white/40">Sent</span>;
  };

  // =====================================================
  // CHAT INFO PANEL: files sent
  // =====================================================
  const chatMediaFiles = useMemo(() => {
    return messages
      .filter((m) => m.media && m.media.length > 0)
      .flatMap((m) => m.media || []);
  }, [messages]);

  // =====================================================
  // ONLINE STATUS TEXT
  // =====================================================
  const lastSeenText = useMemo(() => {
    if (otherUserOnline) return "Online";
    if (otherUser?.last_seen_at) {
      return `Last seen ${formatDistanceToNow(new Date(otherUser.last_seen_at), { addSuffix: true })}`;
    }
    return "";
  }, [otherUserOnline, otherUser?.last_seen_at]);

  // =====================================================
  // EDITOR KEYBOARD HANDLER
  // =====================================================
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "b") { e.preventDefault(); applyBold(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "i") { e.preventDefault(); applyItalic(); }
  };

  // =====================================================
  // LOADING / AUTH GUARDS
  // =====================================================
  if (authLoading || !user) return null;
  if (user.is_vip === false) return null;

  if (loading) {
    return (
          <div
      className="fixed flex flex-col bg-[#0a0812]"
      style={{
        top: 0,
        left: 0,
        right: 0,
        bottom: "var(--keyboard-height, 0px)",
      }}
    >
        <div className="glass-header flex items-center gap-3 px-4 shrink-0" style={{ height: "calc(3.5rem + env(safe-area-inset-top, 0px))", paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <Skeleton className="w-5 h-5 rounded" />
          <Skeleton className="w-10 h-10 rounded-full" />
          <div>
            <Skeleton className="w-28 h-4 mb-1" />
            <Skeleton className="w-16 h-3" />
          </div>
        </div>
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
              <Skeleton className={`h-12 rounded-2xl ${i % 2 === 0 ? "w-48" : "w-36"}`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!otherUser) return null;

  return (
    <div
  className="fixed left-0 right-0 top-0 flex flex-col bg-[#0a0812]"
  style={{ bottom: "var(--keyboard-height, 0px)" }}
>
      {/* =====================================================
          HEADER — with safe area inset
          ===================================================== */}
      <header
        className="glass-header flex items-center justify-between px-4 shrink-0 z-10"
        style={{
          height: "calc(3.5rem + env(safe-area-inset-top, 0px))",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push("/messages")}
            className="p-1.5 -ml-1 hover:bg-white/5 rounded-lg active:scale-95 transition-transform"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>

          <button
            onClick={() => {
              if (otherUser.avatar_url) setAvatarPreview(otherUser.avatar_url);
            }}
            className="relative shrink-0 active:scale-95 transition-transform"
          >
            <div className="w-9 h-9 rounded-full overflow-hidden bg-dark-800 border border-white/10 flex items-center justify-center">
              {otherUser.avatar_url ? (
                <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-4 h-4 text-dark-400" />
              )}
            </div>
            {otherUserOnline && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-purple-500 border-2 border-[#0a0812] online-dot-pulse" />
            )}
          </button>

          <button onClick={() => setShowChatInfo(true)} className="min-w-0 text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-dark-100 truncate">
                {otherUser.full_name || "Unknown"}
              </span>
              {otherUser.is_admin && <Crown className="w-3.5 h-3.5 text-yellow-400 shrink-0" />}
            </div>
            <p className="text-[11px] text-dark-500 truncate">
              {typingUsers.length > 0 ? (
                <span className="text-primary-400">typing...</span>
              ) : (
                <span className={otherUserOnline ? "text-purple-400" : ""}>{lastSeenText}</span>
              )}
            </p>
          </button>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-white/5 rounded-lg active:scale-95 transition-transform"
          >
            <MoreVertical className="w-5 h-5 text-dark-300" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 glass-strong rounded-xl overflow-hidden z-20 shadow-2xl border border-white/10 animate-in fade-in slide-in-from-top-2 duration-150">
                <button
                  onClick={() => { setShowMenu(false); setShowChatInfo(true); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left"
                >
                  <Info className="w-4 h-4 text-dark-400" />
                  <span className="text-sm text-dark-200">Chat info</span>
                </button>
                <button onClick={toggleMute} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left">
                  {isMuted ? <Volume2 className="w-4 h-4 text-dark-400" /> : <VolumeX className="w-4 h-4 text-dark-400" />}
                  <span className="text-sm text-dark-200">{isMuted ? "Unmute" : "Mute"}</span>
                </button>
                <button onClick={toggleBlock} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left">
                  <Ban className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-red-400">{isBlocked ? "Unblock" : "Block"}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* =====================================================
          MESSAGES
          ===================================================== */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-0.5">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-primary-600/10 flex items-center justify-center mx-auto mb-3">
                <Send className="w-8 h-8 text-primary-400" />
              </div>
              <p className="text-sm text-dark-400">Send a message to start the conversation</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const isMine = msg.sender_id === user.id;
              const prev = idx > 0 ? messages[idx - 1] : null;
              const showDate = !prev || getDateLabel(msg.created_at) !== getDateLabel(prev.created_at);
              const showAvatar = !isMine && (!messages[idx + 1] || messages[idx + 1].sender_id !== msg.sender_id);
              const isSwipingThis = swipingMsgId === msg.id;

                return (
                <div key={msg.id} data-msg-id={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-4">
                      <span className="text-[11px] text-dark-500 bg-dark-900/80 px-3 py-1 rounded-full border border-white/5">
                        {getDateLabel(msg.created_at)}
                      </span>
                    </div>
                  )}

                  <div
                   className={`flex items-end gap-2 mb-0.5 ${isMine ? "justify-end" : "justify-start"} relative transition-all duration-500 ${
  highlightedMsgId === msg.id
    ? "bg-primary-500/10 rounded-2xl ring-1 ring-primary-500/30 shadow-[0_0_24px_rgba(168,85,247,0.2)]"
    : ""
}`}
                    onTouchStart={(e) => {
                      handleTouchStart(msg, e);
                      handleSwipeStart(msg.id, e);
                    }}
                    onTouchMove={(e) => handleSwipeMove(msg, e)}
                    onTouchEnd={() => {
                      handleTouchEnd();
                      handleSwipeEnd(msg);
                    }}
                    onMouseDown={(e) => handleTouchStart(msg, e)}
                    onMouseUp={handleTouchEnd}
                    onMouseLeave={handleTouchEnd}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!msg.is_deleted) {
                        setContextMenuMsg(msg);
                        setContextMenuPos({ x: e.clientX, y: e.clientY });
                      }
                    }}
                  >
                    {/* Swipe reply indicator — positioned behind the bubble */}
                    {isSwipingThis && swipeX > 10 && !isMine && (
                      <div
                        className="absolute left-0 top-1/2 -translate-y-1/2 z-0"
                        style={{ opacity: Math.min(swipeX / 60, 1) }}
                      >
                        <div className="w-8 h-8 rounded-full bg-primary-600/20 flex items-center justify-center">
                          <Reply className="w-4 h-4 text-primary-400" />
                        </div>
                      </div>
                    )}
                    {isSwipingThis && swipeX > 10 && isMine && (
  <div
    className="absolute right-0 top-1/2 -translate-y-1/2 z-0"
    style={{
      opacity: Math.min(swipeX / 60, 1),
      transform: `translate(-${swipeX}px, -50%)`,
    }}
  >
    <div className="w-8 h-8 rounded-full bg-primary-600/20 flex items-center justify-center">
      <Reply className="w-4 h-4 text-primary-400" />
    </div>
  </div>
)}

                    {/* Other user avatar */}
                    {!isMine && (
                      <div className="w-7 shrink-0">
                        {showAvatar && (
                          <button
                            onClick={() => {
                              if (otherUser.avatar_url) setAvatarPreview(otherUser.avatar_url);
                            }}
                            className="w-7 h-7 rounded-full overflow-hidden bg-dark-800 border border-white/10"
                          >
                            {otherUser.avatar_url ? (
                              <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <User className="w-3.5 h-3.5 text-dark-400 m-auto mt-1.5" />
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Message bubble — THIS is what moves on swipe */}
                   <div
  className={`max-w-[75%] relative z-[1] ${
    contextMenuMsg?.id === msg.id
      ? "scale-[1.03] ring-2 ring-primary-500/40 rounded-2xl shadow-[0_0_20px_rgba(168,85,247,0.15)]"
      : ""
  }`}
  style={{
    transform: isSwipingThis
      ? `translateX(${isMine ? -swipeX : swipeX}px)`
      : undefined,
    transition: isSwipingThis
      ? "none"
      : "transform 200ms ease-out, box-shadow 200ms ease-out",
  }}
>
                      {msg.is_deleted ? (
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-xs italic ${
                            isMine
                              ? "bg-dark-800/50 text-dark-500 rounded-br-md"
                              : "bg-dark-800/30 text-dark-500 rounded-bl-md"
                          }`}
                        >
                          Message deleted
                        </div>
                      ) : (
                        <div>
                         {/* Reply preview */}
{msg.reply_to && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      if (msg.reply_to_id) scrollToMessage(msg.reply_to_id);
    }}
    className={`w-full text-left px-3 py-1.5 mb-0.5 rounded-t-2xl border-l-2 border-primary-500 active:scale-[0.98] transition-transform ${
      isMine ? "bg-primary-700/30" : "bg-white/5"
    }`}
  >
    <p className="text-[10px] text-primary-400 font-medium">
      {msg.reply_to.sender_id === user.id ? "You" : otherUser?.full_name || "Unknown"}
    </p>
    <p className="text-[11px] text-dark-400 truncate">
      {msg.reply_to.content?.slice(0, 60) || "Attachment"}
    </p>
  </button>
)}

                          <div
                            className={`px-4 py-2.5 ${msg.reply_to ? "rounded-b-2xl" : "rounded-2xl"} ${
                              isMine
                                ? `bg-primary-600/90 text-white ${msg.reply_to ? "rounded-br-md" : "rounded-br-md"}`
                                : `bg-[#1a1525] border border-white/5 text-dark-100 ${msg.reply_to ? "rounded-bl-md" : "rounded-bl-md"}`
                            }`}
                          >
                            {/* Media */}
                            {msg.media && msg.media.length > 0 && (
                              <div className="mb-2 space-y-2">
                                {msg.media.map((m) => (
                                  <div key={m.id}>
                                    {m.media_type === "image" && (
                                      <img
                                        src={m.url}
                                        alt=""
                                        className="rounded-xl max-w-full max-h-60 object-cover cursor-pointer active:scale-[0.98] transition-transform"
                                        onClick={() => setLightboxImage(m.url)}
                                      />
                                    )}
                                    {m.media_type === "video" && (
                                      <div
                                        className="cursor-pointer active:scale-[0.98] transition-transform relative"
                                        onClick={() => setLightboxVideo(m.url)}
                                      >
                                        <video
                                          src={m.url}
                                          className="rounded-xl max-w-full max-h-60"
                                          preload="metadata"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                          <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                                            <div className="w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-l-14 border-l-white ml-1" />
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                    {m.media_type === "audio" && (
                                      <div
                                        className={`p-3 rounded-xl border ${
                                          isMine
                                            ? "border-white/20 bg-white/10"
                                            : "border-white/10 bg-white/5"
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 mb-2">
                                          <Mic className="w-4 h-4 text-primary-400 shrink-0" />
                                          <span className="text-xs font-medium">
                                            {m.file_name || "Voice note"}
                                          </span>
                                        </div>
                                        <audio
                                          controls
                                          preload="metadata"
                                          className="w-full h-8 [&::-webkit-media-controls-panel]:bg-transparent"
                                          style={{ maxWidth: "100%" }}
                                        >
                                          <source src={m.url} />
                                          Your browser does not support audio.
                                        </audio>
                                      </div>
                                    )}
                                    {m.media_type === "document" && (
                                      <a
                                        href={m.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`flex items-center gap-3 p-3 rounded-xl border active:scale-[0.98] transition-transform ${
                                          isMine
                                            ? "border-white/20 bg-white/10"
                                            : "border-white/10 bg-white/5"
                                        }`}
                                      >
                                        <div className="w-10 h-10 rounded-lg bg-primary-600/20 flex items-center justify-center shrink-0 text-lg">
                                          {getDocIcon(m.file_name)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm font-medium truncate">
                                            {m.file_name || "Document"}
                                          </p>
                                          <p className={`text-xs ${isMine ? "text-white/60" : "text-dark-500"}`}>
                                            {m.file_size
                                              ? m.file_size > 1024 * 1024
                                                ? `${(m.file_size / (1024 * 1024)).toFixed(1)} MB`
                                                : `${(m.file_size / 1024).toFixed(0)} KB`
                                              : "Download"}
                                          </p>
                                        </div>
                                        <Download className={`w-4 h-4 shrink-0 ${isMine ? "text-white/60" : "text-dark-400"}`} />
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Post share */}
                            {msg.content_type === "post_share" && msg.metadata?.post_id && (
                              <button
                                onClick={() => router.push(`/post/${msg.metadata.post_id}`)}
                                className={`mb-2 w-full p-3 rounded-xl border text-left active:scale-[0.98] transition-transform ${
                                  isMine ? "border-white/20 bg-white/10" : "border-white/10 bg-white/5"
                                }`}
                              >
                                <p className="text-xs font-medium text-primary-400 mb-1">📍 Shared Post</p>
                                <p className="text-sm truncate">{msg.metadata.post_preview || "View post"}</p>
                              </button>
                            )}

                            {/* Text content */}
                            {msg.content && renderContent(msg.content)}

                            {/* Timestamp + delivery status */}
                            <div className={`flex items-center gap-1.5 mt-1.5 ${isMine ? "justify-end" : "justify-start"}`}>
                              <span className={`text-[10px] ${isMine ? "text-white/50" : "text-dark-500"}`}>
                                {format(new Date(msg.created_at), "HH:mm")}
                              </span>
                              {msg.edited_at && (
                                <span className={`text-[10px] ${isMine ? "text-white/40" : "text-dark-600"}`}>
                                  · edited
                                </span>
                              )}
                              {isMine && <DeliveryLabel status={msg.delivery_status} />}
                            </div>
                          </div>

                          {/* Reactions display */}
                          {msg.reactions && msg.reactions.length > 0 && (
                            <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                              {Object.entries(
                                msg.reactions.reduce((acc, r) => {
                                  acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                                  return acc;
                                }, {} as Record<string, number>)
                              ).map(([emoji, count]) => {
                                const myReaction = msg.reactions?.some(
                                  (r) => r.emoji === emoji && r.user_id === user.id
                                );
                                return (
                                  <button
                                    key={emoji}
                                    onClick={() => toggleReaction(msg.id, emoji)}
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                                      myReaction
                                        ? "border-primary-500/40 bg-primary-600/20"
                                        : "border-white/10 bg-white/5 hover:bg-white/10"
                                    }`}
                                  >
                                    <span>{emoji}</span>
                                    {(count as number) > 1 && (
                                      <span className="text-[10px] text-dark-300">{count as number}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div className="flex items-end gap-2 justify-start">
                <div className="w-7 shrink-0">
                  <div className="w-7 h-7 rounded-full overflow-hidden bg-dark-800 border border-white/10">
                    {otherUser.avatar_url ? (
                      <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-3.5 h-3.5 text-dark-400 m-auto mt-1.5" />
                    )}
                  </div>
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-[#1a1525] border border-white/5">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-dark-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-dark-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-dark-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* =====================================================
          BLOCKED BANNER
          ===================================================== */}
      {isBlocked && (
        <div className="px-4 py-3 bg-red-500/10 border-t border-red-500/20 text-center">
          <p className="text-sm text-red-400">You have blocked this user</p>
          <button onClick={toggleBlock} className="text-xs text-red-300 underline mt-1">
            Unblock
          </button>
        </div>
      )}

      {/* =====================================================
          REPLY BANNER
          ===================================================== */}
      {replyingTo && !isBlocked && (
        <div className="px-4 py-2 border-t border-primary-500/20 bg-primary-600/5 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Reply className="w-4 h-4 text-primary-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-primary-400 font-medium">
                Replying to {replyingTo.sender_id === user.id ? "yourself" : otherUser?.full_name || "Unknown"}
              </p>
              <p className="text-xs text-dark-400 truncate">{replyingTo.content?.slice(0, 60) || "Attachment"}</p>
            </div>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            className="p-1 rounded-lg hover:bg-white/10"
          >
            <X className="w-4 h-4 text-dark-400" />
          </button>
        </div>
      )}

      {/* =====================================================
          EDITING BANNER
          ===================================================== */}
      {editingMessage && !isBlocked && (
        <div className="px-4 py-2 border-t border-primary-500/20 bg-primary-600/5 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Pencil className="w-4 h-4 text-primary-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-primary-400 font-medium">Editing message</p>
              <p className="text-xs text-dark-400 truncate">{editingMessage.content?.slice(0, 60)}</p>
            </div>
          </div>
          <button
            onClick={() => { setEditingMessage(null); clearEditor(); }}
            className="p-1 rounded-lg hover:bg-white/10"
          >
            <X className="w-4 h-4 text-dark-400" />
          </button>
        </div>
      )}

      {/* =====================================================
          PENDING MEDIA PREVIEW
          ===================================================== */}
      {pendingMedia.length > 0 && (
        <div className="px-4 py-2 border-t border-white/5 bg-[#0d0a14]">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pendingMedia.map((m, i) => (
              <div key={i} className="relative shrink-0">
                {m.preview ? (
                  <img src={m.preview} alt="" className="w-16 h-16 rounded-xl object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-dark-800 border border-white/10 flex flex-col items-center justify-center gap-0.5">
                    {m.type.startsWith("audio/") ? (
                      <>
                        <Mic className="w-5 h-5 text-primary-400" />
                        <span className="text-[9px] text-dark-400">Voice</span>
                      </>
                    ) : (
                      <FileIcon className="w-6 h-6 text-dark-400" />
                    )}
                  </div>
                )}
                <button
                  onClick={() => removePendingMedia(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center active:scale-90 transition-transform"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================
          FORMAT BAR
          ===================================================== */}
      {showFormatBar && !isBlocked && (
        <div className="px-4 py-2 border-t border-white/5 bg-[#0d0a14] flex items-center justify-center gap-3">
          <button onClick={applyBold} className="p-2.5 rounded-lg hover:bg-white/10 active:scale-90 text-dark-300 hover:text-white transition-all" title="Bold"><Bold className="w-4 h-4" /></button>
          <button onClick={applyItalic} className="p-2.5 rounded-lg hover:bg-white/10 active:scale-90 text-dark-300 hover:text-white transition-all" title="Italic"><Italic className="w-4 h-4" /></button>
          <button onClick={applyBulletList} className="p-2.5 rounded-lg hover:bg-white/10 active:scale-90 text-dark-300 hover:text-white transition-all" title="Bullets"><List className="w-4 h-4" /></button>
          <button onClick={applyNumberedList} className="p-2.5 rounded-lg hover:bg-white/10 active:scale-90 text-dark-300 hover:text-white transition-all" title="Numbers"><ListOrdered className="w-4 h-4" /></button>
        </div>
      )}

      {/* =====================================================
          LINK INPUT
          ===================================================== */}
      {showLinkInput && !isBlocked && (
        <div className="px-4 py-3 border-t border-white/5 bg-[#0d0a14] space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-dark-400 font-medium">Insert Link</p>
            <button onClick={() => { setShowLinkInput(false); setLinkUrl(""); setLinkText(""); }} className="p-1 rounded-lg hover:bg-white/10 text-dark-400">
              <X className="w-4 h-4" />
            </button>
          </div>
          {linkText && <p className="text-xs text-dark-500">Text: <span className="text-dark-300">{linkText}</span></p>}
          <div className="flex gap-2">
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); insertLink(); } }}
              className="flex-1 h-9 px-3 bg-[#1a1525] border border-white/10 rounded-lg text-sm text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-primary-500/40"
            />
            <button onClick={insertLink} disabled={!linkUrl.trim()} className="px-4 h-9 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-30 active:scale-95 transition-transform">
              Add
            </button>
          </div>
        </div>
      )}

      {/* =====================================================
    EMOJI PICKER (inline, above input bar)
    ===================================================== */}
{showEmoji && !isBlocked && (
  <div className="border-t border-white/10 bg-[#0d0a14] flex flex-col shrink-0" style={{ maxHeight: "40vh" }}>
    <div className="flex items-center gap-0.5 px-2 py-2 border-b border-white/5 overflow-x-auto scrollbar-hide shrink-0">
      {EMOJI_TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setEmojiTab(tab.key)}
          className={`px-3 py-1.5 rounded-lg text-lg shrink-0 transition-colors ${
            emojiTab === tab.key ? "bg-primary-600/20" : "hover:bg-white/5"
          }`}
        >
          {tab.label}
        </button>
      ))}
      <button onClick={() => setShowEmoji(false)} className="ml-auto p-1.5 rounded-lg hover:bg-white/10 text-dark-400 shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
      {(() => {
        const tab = EMOJI_TABS.find((t) => t.key === emojiTab);
        if (!tab) return null;
        const isKaomoji = tab.key === "kaomoji";
        return (
          <div className={isKaomoji ? "flex flex-wrap gap-1" : "grid grid-cols-9 gap-px"}>
            {tab.emojis.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                onClick={() => {
                  if (editorRef.current) {
                    editorRef.current.focus();
                    document.execCommand("insertText", false, emoji);
                  }
                }}
                className={
                  isKaomoji
                    ? "px-2 py-1.5 rounded-lg hover:bg-white/10 active:scale-95 text-xs text-dark-200 border border-white/5 transition-all"
                    : "w-full aspect-square flex items-center justify-center rounded-md hover:bg-white/10 active:scale-90 text-[22px] leading-none transition-all"
                }
              >
                {emoji}
              </button>
            ))}
          </div>
        );
      })()}
    </div>
  </div>
)}

      {/* =====================================================
          INPUT BAR
          ===================================================== */}
      {!isBlocked && (
  <div
    className="px-3 py-2 border-t border-white/5 bg-[#0d0a14] shrink-0 relative"
          style={{
  paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
}}
        >
          <div className="flex items-end gap-1.5">
            <div className="relative shrink-0">
              <button
                onClick={() => { setShowAttach(!showAttach); setShowEmoji(false); setShowLinkInput(false); }}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 text-dark-400 hover:text-white active:scale-90 transition-all"
              >
                <Plus className="w-5 h-5" />
              </button>
              {showAttach && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAttach(false)} />
                  <div className="absolute bottom-full left-0 mb-2 z-20 glass-strong rounded-xl overflow-hidden shadow-2xl border border-white/10 w-48 animate-in fade-in slide-in-from-bottom-2 duration-150">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                    >
                      <ImageIcon className="w-4 h-4 text-primary-400" />
                      <span className="text-sm text-dark-200">Photo / Video</span>
                    </button>
                    <button
                      onClick={() => docInputRef.current?.click()}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                    >
                      <FileText className="w-4 h-4 text-primary-400" />
                      <span className="text-sm text-dark-200">Document</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div
                ref={editorRef}
                contentEditable
                role="textbox"
                aria-multiline="true"
                data-placeholder={editingMessage ? "Edit message..." : replyingTo ? "Reply..." : "Message..."}
                onInput={() => sendTyping()}
                onKeyDown={handleEditorKeyDown}
                className="w-full bg-[#1a1525] border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-dark-100 focus:outline-none focus:border-primary-500/40 resize-none transition-colors overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-dark-500 empty:before:pointer-events-none [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_a]:text-primary-400 [&_a]:underline [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4"
                style={{ minHeight: 40, maxHeight: 120 }}
                suppressContentEditableWarning
              />
            </div>

            <button
              onClick={() => { setShowFormatBar(!showFormatBar); setShowEmoji(false); setShowLinkInput(false); }}
              className={`w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all shrink-0 ${
                showFormatBar ? "text-primary-400" : "text-dark-400 hover:text-white"
              }`}
            >
              <Bold className="w-4 h-4" />
            </button>

            <button
              onClick={() => { setShowEmoji(!showEmoji); setShowAttach(false); setShowFormatBar(false); setShowLinkInput(false); }}
              className={`w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all shrink-0 ${
                showEmoji ? "text-primary-400" : "text-dark-400 hover:text-white"
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>

            {isEditorEmpty() && pendingMedia.length === 0 && !editingMessage ? (
              isRecording ? (
                <button
                  onClick={stopRecording}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-500 text-white active:scale-90 transition-all shrink-0 animate-pulse"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 text-dark-400 hover:text-white active:scale-90 transition-all shrink-0"
                >
                  <Mic className="w-5 h-5" />
                </button>
              )
            ) : (
              <button
                onClick={handleSend}
                disabled={sending}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary-600 hover:bg-primary-500 text-white active:scale-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            )}
          </div>

          {isRecording && (
            <div className="flex items-center gap-2 mt-2 px-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-400 font-mono">{formatDuration(recordingDuration)}</span>
              <span className="text-xs text-dark-500">Recording...</span>
            </div>
          )}
        </div>
      )}

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileSelect} />
      <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.txt,.xlsx,.xls,.pptx,.ppt,.zip,.rar" multiple className="hidden" onChange={handleFileSelect} />

      {/* =====================================================
          CONTEXT MENU (Long Press Menu) — with reactions + reply
          ===================================================== */}
      {contextMenuMsg && contextMenuPos && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[99999]" onClick={() => setContextMenuMsg(null)}>
            <div
              className="absolute glass-strong rounded-xl overflow-hidden shadow-2xl border border-white/10 w-64 animate-in fade-in zoom-in-95 duration-150"
              style={{
  left: Math.min(contextMenuPos.x, window.innerWidth - 272),
  top: Math.min(contextMenuPos.y - 10, window.innerHeight - 400),
}}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Quick Reactions row */}
{!contextMenuMsg.is_deleted && (
  <div className="flex items-center justify-around px-3 py-2.5 border-b border-white/5">
    {QUICK_REACTIONS.map((emoji) => (
      <button
        key={emoji}
        onClick={() => toggleReaction(contextMenuMsg.id, emoji)}
        className="text-xl hover:scale-125 active:scale-90 transition-transform p-1"
      >
        {emoji}
      </button>
    ))}
    <button
      onClick={(e) => {
        e.stopPropagation();
        setReactionPickerMsgId(contextMenuMsg.id);
        setReactionPickerTab("smileys");
        setContextMenuMsg(null);
        setContextMenuPos(null);
      }}
      className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 active:scale-90 transition-all"
    >
      <Plus className="w-4 h-4 text-dark-300" />
    </button>
  </div>
)}

              {/* Reply */}
              {!contextMenuMsg.is_deleted && (
                <button
                  onClick={() => handleReply(contextMenuMsg)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                >
                  <Reply className="w-4 h-4 text-dark-400" />
                  <span className="text-sm text-dark-200">Reply</span>
                </button>
              )}

              {/* Copy */}
              {contextMenuMsg.content && (
                <button
                  onClick={() => handleCopy(contextMenuMsg.content)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                >
                  <Copy className="w-4 h-4 text-dark-400" />
                  <span className="text-sm text-dark-200">Copy</span>
                </button>
              )}

              {/* Edit */}
              {contextMenuMsg.sender_id === user.id &&
                contextMenuMsg.content &&
                !contextMenuMsg.is_deleted && (
                  <button
                    onClick={() => handleEdit(contextMenuMsg)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                  >
                    <Pencil className="w-4 h-4 text-dark-400" />
                    <span className="text-sm text-dark-200">Edit</span>
                  </button>
                )}

              {/* Delete for me */}
              <button
                onClick={() => handleDeleteForMe(contextMenuMsg.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
              >
                <Trash2 className="w-4 h-4 text-dark-400" />
                <span className="text-sm text-dark-200">Delete for me</span>
              </button>

              {/* Delete for everyone */}
              {contextMenuMsg.sender_id === user.id && !contextMenuMsg.is_deleted && (
                <button
                  onClick={() => handleDeleteForEveryone(contextMenuMsg.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-red-400">Delete for everyone</span>
                </button>
              )}
            </div>
          </div>,
          document.body
        )}

        {/* =====================================================
    REACTION EMOJI PICKER (full picker from + button)
    ===================================================== */}
{reactionPickerMsgId && typeof document !== "undefined" &&
  createPortal(
    <div
      className="fixed inset-0 z-[99999] flex flex-col justify-end"
      onClick={() => setReactionPickerMsgId(null)}
    >
      <div
        className="bg-[#0d0a14] border-t border-white/10 rounded-t-3xl max-h-[50vh] flex flex-col animate-[slideUp_200ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-0.5 px-2 py-2 border-b border-white/5 overflow-x-auto scrollbar-hide shrink-0">
          {EMOJI_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setReactionPickerTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-lg shrink-0 transition-colors ${
                reactionPickerTab === tab.key ? "bg-primary-600/20" : "hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            onClick={() => setReactionPickerMsgId(null)}
            className="ml-auto p-1.5 rounded-lg hover:bg-white/10 text-dark-400 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
          {(() => {
            const tab = EMOJI_TABS.find((t) => t.key === reactionPickerTab);
            if (!tab) return null;
            const isKaomoji = tab.key === "kaomoji";
            return (
              <div className={isKaomoji ? "flex flex-wrap gap-1" : "grid grid-cols-9 gap-px"}>
                {tab.emojis.map((emoji, i) => (
                  <button
                    key={`${emoji}-${i}`}
                    onClick={() => {
                      if (reactionPickerMsgId) {
                        toggleReaction(reactionPickerMsgId, emoji);
                        setReactionPickerMsgId(null);
                      }
                    }}
                    className={
                      isKaomoji
                        ? "px-2 py-1.5 rounded-lg hover:bg-white/10 active:scale-95 text-xs text-dark-200 border border-white/5 transition-all"
                        : "w-full aspect-square flex items-center justify-center rounded-md hover:bg-white/10 active:scale-90 text-[22px] leading-none transition-all"
                    }
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>,
    document.body
  )}

      {/* =====================================================
          AVATAR PREVIEW
          ===================================================== */}
      {avatarPreview && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation();
              setAvatarPreview(null);
            }}
          >
            <div className="animate-in fade-in zoom-in-90 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="w-72 h-72 rounded-full overflow-hidden border-4 border-white/20 shadow-2xl">
                <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
              </div>
              <p className="text-center mt-4 text-sm text-dark-200 font-medium">
                {otherUser?.full_name || "Unknown"}
              </p>
            </div>
          </div>,
          document.body
        )}

      {/* =====================================================
          CHAT INFO PANEL
          ===================================================== */}
      {showChatInfo && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[99998] bg-[#0a0812] flex flex-col animate-in slide-in-from-right duration-200">
            <header
              className="glass-header flex items-center gap-3 px-4 shrink-0"
              style={{
                height: "calc(3.5rem + env(safe-area-inset-top, 0px))",
                paddingTop: "env(safe-area-inset-top, 0px)",
              }}
            >
              <button
                onClick={() => setShowChatInfo(false)}
                className="p-1.5 -ml-1 hover:bg-white/5 rounded-lg active:scale-95 transition-transform"
              >
                <ArrowLeft className="w-5 h-5 text-dark-200" />
              </button>
              <h2 className="text-sm font-semibold text-dark-100">Chat Info</h2>
            </header>

            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col items-center py-8 px-4">
                <div className="relative mb-3">
  <button
    onClick={() => {
      if (otherUser?.avatar_url) {
        setAvatarPreview(otherUser.avatar_url);
      }
    }}
    className="w-24 h-24 rounded-full overflow-hidden bg-dark-800 border-2 border-white/10"
  >
    {otherUser?.avatar_url ? (
      <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
    ) : (
      <User className="w-12 h-12 text-dark-400 m-auto mt-5" />
    )}
  </button>
  {otherUserOnline && (
    <div className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-purple-500 border-[3px] border-[#0a0812] online-dot-pulse" />
  )}
</div>
                <h3 className="text-lg font-semibold text-dark-100 flex items-center gap-2">
                  {otherUser?.full_name || "Unknown"}
                  {otherUser?.is_admin && <Crown className="w-4 h-4 text-yellow-400" />}
                </h3>
                <p className="text-sm text-dark-400">{otherUser?.email}</p>
                <p className={`text-xs mt-1 ${otherUserOnline ? "text-purple-400" : "text-dark-500"}`}>
                  {lastSeenText}
                </p>
              </div>

              <div className="px-4 py-4 border-t border-white/5">
                <h4 className="text-sm font-medium text-dark-200 mb-3 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-primary-400" />
                  Shared Media & Files ({chatMediaFiles.length})
                </h4>
                {chatMediaFiles.length === 0 ? (
                  <p className="text-xs text-dark-500">No media shared yet</p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {chatMediaFiles.slice(0, 12).map((m) => (
                      <div key={m.id}>
                        {m.media_type === "image" ? (
                          <button
                            onClick={() => setLightboxImage(m.url)}
                            className="w-full aspect-square rounded-lg overflow-hidden bg-dark-800"
                          >
                            <img src={m.url} alt="" className="w-full h-full object-cover" />
                          </button>
                        ) : m.media_type === "video" ? (
                          <button
                            onClick={() => setLightboxVideo(m.url)}
                            className="w-full aspect-square rounded-lg overflow-hidden bg-dark-800 relative"
                          >
                            <video src={m.url} className="w-full h-full object-cover" preload="metadata" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <div className="w-6 h-6 rounded-full bg-white/80 flex items-center justify-center">
                                <div className="w-0 h-0 border-t-4 border-t-transparent border-b-4 border-b-transparent border-l-[7px] border-l-black ml-0.5" />
                              </div>
                            </div>
                          </button>
                        ) : (
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full aspect-square rounded-lg bg-dark-800 border border-white/10 flex flex-col items-center justify-center gap-1"
                          >
                            <span className="text-lg">{m.media_type === "audio" ? "🎵" : getDocIcon(m.file_name)}</span>
                            <span className="text-[9px] text-dark-400 truncate max-w-full px-1">
                              {m.file_name?.split(".").pop()?.toUpperCase() || "FILE"}
                            </span>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-4 py-4 border-t border-white/5 space-y-1">
                <button
                  onClick={toggleMute}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                >
                  {isMuted ? <Volume2 className="w-5 h-5 text-dark-400" /> : <VolumeX className="w-5 h-5 text-dark-400" />}
                  <span className="text-sm text-dark-200">{isMuted ? "Unmute notifications" : "Mute notifications"}</span>
                </button>

                <button
                  onClick={deleteChat}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                >
                  <Trash2 className="w-5 h-5 text-red-400" />
                  <span className="text-sm text-red-400">Clear chat</span>
                </button>

                <button
                  onClick={() => { setShowChatInfo(false); toggleBlock(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                >
                  <Ban className="w-5 h-5 text-red-400" />
                  <span className="text-sm text-red-400">{isBlocked ? "Unblock user" : "Block user"}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* =====================================================
          LIGHTBOXES
          ===================================================== */}
      <ImageLightbox
        isOpen={!!lightboxImage}
        onClose={() => setLightboxImage(null)}
        imageUrl={lightboxImage}
      />

      <VideoLightbox
        isOpen={!!lightboxVideo}
        onClose={() => setLightboxVideo(null)}
        videoUrl={lightboxVideo}
      />
    </div>
  );
}