"use client";

import {
  useEffect,
  useLayoutEffect,
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
import { VoiceNotePlayer } from "@/components/messages/VoiceNotePlayer";
import { VoiceNoteRecorder } from "@/components/messages/VoiceNoteRecorder";
import { useMessageCache } from "@/context/MessageCacheContext";
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
  AlertTriangle,
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
  const { setRecordingConversationId, clearUnread, markConversationRead } = useMessageCache();
  const MSG_CACHE_KEY = `peja-chat-cache-${conversationId}`;

  // ------ Core State ------
  const [messages, setMessages] = useState<Message[]>([]);
  const [otherUser, setOtherUser] = useState<VIPUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadingMsgIds, setUploadingMsgIds] = useState<Map<string, number>>(new Map());

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
  const [recordingUsers, setRecordingUsers] = useState<string[]>([]);
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
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voiceNoteUploading, setVoiceNoteUploading] = useState(false);

  // ------ Swipe to Reply ------
  const [swipingMsgId, setSwipingMsgId] = useState<string | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const swipeStartRef = useRef<{ x: number; y: number; locked: boolean } | null>(null);

  // ------ Plus button animation ------
  const [plusRotated, setPlusRotated] = useState(false);

  // ------ Refs ------
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);
  const presenceChannelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialScrollDone = useRef(false);
  const hasRenderedOnce = useRef(false);
  const messagesLengthRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const myDeletionsRef = useRef<Set<string>>(new Set());
  const otherUserOnlineRef = useRef(false);

  // Reset scroll flags when conversation changes
  useEffect(() => {
    initialScrollDone.current = false;
    hasRenderedOnce.current = false;
    messagesLengthRef.current = 0;
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
  // CLEAR UNREAD IMMEDIATELY ON MOUNT
  // =====================================================
  useEffect(() => {
    if (conversationId && user?.id) {
      // Clear unread badge INSTANTLY via context (optimistic)
      clearUnread(conversationId);
      
      // Mark as read in database (background, non-blocking)
      markConversationRead(conversationId);
      
      // Store for reference
      try {
        sessionStorage.setItem("peja-last-chat-id", conversationId);
      } catch {}
    }
  }, [conversationId, user?.id, clearUnread, markConversationRead]);

    // =====================================================
  // BROADCAST RECORDING STATE
  // =====================================================
  useEffect(() => {
    if (isRecording) {
      setRecordingConversationId(conversationId);
    } else {
      setRecordingConversationId(null);
    }
    
    return () => {
      setRecordingConversationId(null);
    };
  }, [isRecording, conversationId, setRecordingConversationId]);

  // =====================================================
  // FETCH CONVERSATION DATA
  // =====================================================
useEffect(() => {
  if (!user?.id || !conversationId) return;

  const fetchData = async () => {
    // STEP 1: Restore cached messages IMMEDIATELY for instant display
    let hasCachedMessages = false;
    try {
      const cached = sessionStorage.getItem(MSG_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          hasCachedMessages = true;
          // Don't set loading to false yet - we still need other user data
        }
      }
    } catch (e) {
      console.error("[Cache] Failed to restore:", e);
    }

    // STEP 2: Try to restore cached other user data
    try {
      const cachedUser = sessionStorage.getItem(`peja-chat-user-${conversationId}`);
      if (cachedUser) {
        const parsed = JSON.parse(cachedUser);
        if (parsed?.id) {
          setOtherUser(parsed);
          setOtherUserOnline(presenceManager.isOnline(parsed.id));
          
          // If we have both cached messages and cached user, show content immediately
          if (hasCachedMessages) {
            setLoading(false);
          }
        }
      }
    } catch (e) {
      console.error("[Cache] Failed to restore user:", e);
    }

    // STEP 3: Fetch fresh data in background
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

      // Cache the user data for instant restore next time
      try {
        sessionStorage.setItem(`peja-chat-user-${conversationId}`, JSON.stringify(otherVIP));
      } catch {}

      const { data: myDeletions } = await supabase
        .from("message_deletions")
        .select("message_id")
        .eq("user_id", user.id);
      myDeletionsRef.current = new Set((myDeletions || []).map((d: any) => d.message_id));

      await fetchMessages(otherReadAt);
      await markAsRead();
      try { sessionStorage.setItem("peja-last-chat-id", conversationId); } catch {}
    } catch (e: any) {
      console.error("Chat fetch error:", e?.message || e);
      // Only redirect if we don't have cached data to show
      if (!hasCachedMessages) {
        router.replace("/messages");
      }
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

    const unsub = presenceManager.onStatusChange((userId, isOnline) => {
      if (userId === otherUser.id) {
        setOtherUserOnline(isOnline);
        otherUserOnlineRef.current = isOnline;
      }
    });

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

    const finalMessages = msgs
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
      });

    setMessages(finalMessages);

    // Cache messages
    try {
      const cacheData = finalMessages.slice(-100);
      sessionStorage.setItem(MSG_CACHE_KEY, JSON.stringify(cacheData));
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
  // SCROLL HELPERS - Column-reverse means scroll 0 = bottom
  // =====================================================
  const scrollToBottom = useCallback((instant = true) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    // With column-reverse, scrollTop 0 is the BOTTOM
    if (instant) {
      container.scrollTop = 0;
    } else {
      container.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
  const container = messagesContainerRef.current;
  if (!container) return;

  const el = container.querySelector(`[data-msg-id="${messageId}"]`) as HTMLElement | null;
  if (!el) return;

  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  // Calculate distance from current view
  const distanceFromTop = elRect.top - containerRect.top;
  const distanceFromBottom = containerRect.bottom - elRect.bottom;
  const isInView = distanceFromTop >= 0 && distanceFromBottom >= 0;

  // If already in view, just highlight
  if (isInView) {
    setHighlightedMsgId(messageId);
    setTimeout(() => setHighlightedMsgId(null), 2000);
    return;
  }

  // Calculate absolute distance
  const absoluteDistance = Math.abs(distanceFromTop);

  // If close (within 2 viewport heights), smooth scroll
  if (absoluteDistance < containerRect.height * 2) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMsgId(messageId);
    setTimeout(() => setHighlightedMsgId(null), 2000);
  } else {
    // If far, jump to near the message first, then smooth scroll
    // This is the WhatsApp behavior for very old messages
    
    // First, instant scroll to roughly where the message is
    el.scrollIntoView({ behavior: "instant", block: "center" });
    
    // Then apply highlight after a tiny delay
    requestAnimationFrame(() => {
      setHighlightedMsgId(messageId);
      setTimeout(() => setHighlightedMsgId(null), 2000);
    });
  }
}, []);

  // =====================================================
  // AUTO-SCROLL ONLY FOR OWN MESSAGES
  // With column-reverse, we're always "at bottom" by default
  // =====================================================
  useEffect(() => {
    if (messages.length === 0) return;
    
    const lastMessage = messages[messages.length - 1];
    const isMyMessage = lastMessage?.sender_id === user?.id;
    
    // Only auto-scroll for messages I send
    if (isMyMessage && messagesLengthRef.current > 0 && messages.length > messagesLengthRef.current) {
      scrollToBottom(true);
    }
    
    messagesLengthRef.current = messages.length;
  }, [messages, user?.id, scrollToBottom]);

// =====================================================
// Keyboard handling - scroll to bottom when keyboard opens
// =====================================================
useEffect(() => {
  const onKeyboardOpen = () => {
    // With column-reverse, scrollTop 0 = bottom
    setTimeout(() => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 150);
  };

  document.body.addEventListener("keyboard-open", onKeyboardOpen);
  
  // Also listen for class changes as a backup
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === "class") {
        if (document.body.classList.contains("keyboard-open")) {
          onKeyboardOpen();
        }
      }
    });
  });
  
  observer.observe(document.body, { attributes: true });

  return () => {
    document.body.removeEventListener("keyboard-open", onKeyboardOpen);
    observer.disconnect();
  };
}, []);

  // Non-passive touch move for swipe
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handler = (e: TouchEvent) => {
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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          const newMsg = payload.new as Message;
          if (myDeletionsRef.current.has(newMsg.id)) return;

          let media: MessageMediaItem[] = [];
if (newMsg.content_type === "media" || newMsg.content_type === "document") {
  // Wait for media to be inserted, with retry
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 800));
    const { data } = await supabase
      .from("message_media")
      .select("*")
      .eq("message_id", newMsg.id);
    
    if (data && data.length > 0) {
      media = data as MessageMediaItem[];
      break;
    }
    
    console.log(`[Realtime] Media fetch attempt ${attempt + 1} - no media found yet`);
  }
}

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

          if (newMsg.sender_id !== user.id) markAsRead();
        }
      )
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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reads" },
        (payload) => {
          const read = payload.new as any;
          if (read.user_id === user.id) return;

          setMessages((prev) => {
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        async (payload) => {
          const reactionData = (payload.new || payload.old) as any;
          if (!reactionData?.message_id) return;

          const { data: reactions } = await supabase
            .from("message_reactions")
            .select("*")
            .eq("message_id", reactionData.message_id);

          setMessages((prev) =>
            prev.map((m) =>
              m.id === reactionData.message_id
                ? { ...m, reactions: reactions || [] }
                : m
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_participants", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const updated = payload.new as any;
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
    
    // Detect typing users
    setTypingUsers(
      Object.keys(state).filter((id) => {
        if (id === user.id) return false;
        return (state[id] as any[]).some((p) => p.typing);
      })
    );
    
    // Detect recording users
    setRecordingUsers(
      Object.keys(state).filter((id) => {
        if (id === user.id) return false;
        return (state[id] as any[]).some((p) => p.recording);
      })
    );
  })
  .subscribe(async (status) => {
    if (status === "SUBSCRIBED") await channel.track({ typing: false, recording: false });
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

  const sendRecordingState = useCallback((isRecording: boolean) => {
  if (!presenceChannelRef.current) return;
  presenceChannelRef.current.track({ typing: false, recording: isRecording });
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
  // RENDER MESSAGE CONTENT (with clickable links)
  // =====================================================
  const renderContent = useCallback((content: string | null) => {
    if (!content) return null;

    let html = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Links FIRST (before other formatting so we don't break URLs)
    html = html.replace(
      /(?<!href=["'])(?<!>)(https?:\/\/[^\s<)]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary-400 underline hover:text-primary-300 break-all">$1</a>'
    );

    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    html = html.replace(
      /`(.*?)`/g,
      '<code class="px-1 py-0.5 rounded bg-white/10 text-xs font-mono">$1</code>'
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
        onClick={(e) => {
          // Allow link clicks to propagate without triggering parent handlers
          const target = e.target as HTMLElement;
          if (target.tagName === "A") {
            e.stopPropagation();
          }
        }}
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
  // REACTIONS — OPTIMISTIC (instant)
  // =====================================================
  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!user?.id) return;

    // Check if reaction already exists locally
    const msg = messages.find((m) => m.id === messageId);
    const existing = msg?.reactions?.find(
      (r) => r.user_id === user.id && r.emoji === emoji
    );

    if (existing) {
      // Optimistically remove
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: (m.reactions || []).filter((r) => r.id !== existing.id) }
            : m
        )
      );

      // Background DB call
      supabase.from("message_reactions").delete().eq("id", existing.id).then(({ error }) => {
        if (error) {
          // Revert on failure
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, reactions: [...(m.reactions || []), existing] }
                : m
            )
          );
        }
      });
    } else {
      // Optimistically add with temp ID
      const tempReaction = {
        id: `temp-${Date.now()}`,
        message_id: messageId,
        user_id: user.id,
        emoji,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions: [...(m.reactions || []), tempReaction] }
            : m
        )
      );

      // Background DB call
      supabase
        .from("message_reactions")
        .insert({ message_id: messageId, user_id: user.id, emoji })
        .select()
        .single()
        .then(({ data: newReaction, error }) => {
          if (error) {
            // Revert on failure
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? { ...m, reactions: (m.reactions || []).filter((r) => r.id !== tempReaction.id) }
                  : m
              )
            );
          } else if (newReaction) {
            // Replace temp with real
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      reactions: (m.reactions || []).map((r) =>
                        r.id === tempReaction.id ? newReaction : r
                      ),
                    }
                  : m
              )
            );
          }
        });
    }

    setContextMenuMsg(null);
    setContextMenuPos(null);
  }, [user?.id, messages]);

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
    setContextMenuPos(null);
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
    setContextMenuPos(null);
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
    setContextMenuPos(null);
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
    setContextMenuPos(null);
  };

  const handleReply = (msg: Message) => {
    setReplyingTo(msg);
    setContextMenuMsg(null);
    setContextMenuPos(null);
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

      const { notifyDMBlocked } = await import("@/lib/notifications");
      notifyDMBlocked(otherUser.id, user.full_name || "Someone");
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
 const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = e.target.files;
  if (!files) return;

  const { validateMediaFile } = await import("@/lib/mediaCompression");

  const newMedia: { file: File; preview: string; type: string }[] = [];

  for (const file of Array.from(files)) {
    // Validate file
    const validation = validateMediaFile(file);
    if (!validation.valid) {
      toast.warning(validation.error || "Invalid file");
      continue;
    }

    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    newMedia.push({ file, preview, type: file.type });
  }

  if (newMedia.length === 0) return;

  setPendingMedia((prev) => [...prev, ...newMedia].slice(0, 5));
  setShowAttach(false);
  setPlusRotated(false);
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
  // Voice recording handlers - delegated to VoiceNoteRecorder component
  const handleRecordingStart = useCallback(() => {
  setIsRecording(true);
  setShowVoiceRecorder(true);
  setShowEmoji(false);
  setShowAttach(false);
  setPlusRotated(false);
  setShowFormatBar(false);
  sendRecordingState(true);
}, [sendRecordingState]);

  const handleRecordingEnd = useCallback((blob: Blob, duration: number) => {
    console.log("[VoiceNote] Recording ended, blob size:", blob.size, "duration:", duration);
    // Recording ended but not cancelled - blob is ready
    // The VoiceNoteRecorder will show the preview and send button
  }, []);

  const handleRecordingCancel = useCallback(() => {
  setIsRecording(false);
  setShowVoiceRecorder(false);
  sendRecordingState(false);
}, [sendRecordingState]);

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // =====================================================
  // LONG PRESS HANDLER — with haptic-style feedback
  // =====================================================
  // Track long press start position for movement detection
const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

const handleTouchStart = (msg: Message, e: React.TouchEvent | React.MouseEvent) => {
  if (msg.is_deleted) return;

  const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
  const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

  // Store start position for movement detection
  longPressStartRef.current = { x: clientX, y: clientY };

  longPressTimerRef.current = setTimeout(() => {
    // Vibrate if available (haptic feedback)
    if (navigator.vibrate) navigator.vibrate(30);
    setContextMenuMsg(msg);
    setContextMenuPos({ x: clientX, y: clientY });
    longPressStartRef.current = null;
  }, 400);
};

const handleTouchMove = (e: React.TouchEvent) => {
  if (!longPressStartRef.current || !longPressTimerRef.current) return;

  const clientX = e.touches[0].clientX;
  const clientY = e.touches[0].clientY;

  const dx = Math.abs(clientX - longPressStartRef.current.x);
  const dy = Math.abs(clientY - longPressStartRef.current.y);

  // Cancel long press if finger moved more than 10px
  if (dx > 10 || dy > 10) {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    longPressStartRef.current = null;
  }
};

const handleTouchEnd = () => {
  if (longPressTimerRef.current) {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }
  longPressStartRef.current = null;
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

    if (!swipeStartRef.current.locked) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        swipeStartRef.current.locked = true;
        if (Math.abs(dy) > Math.abs(dx)) {
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
    const raw = isMine ? -dx : dx;
    const clamped = Math.max(0, Math.min(raw, 80));
    setSwipeX(clamped);

    if (clamped > 5) {
      e.preventDefault();
    }

    if (clamped > 10 && longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSwipeEnd = (msg: Message) => {
    if (swipeX > 60) {
      if (navigator.vibrate) navigator.vibrate(20);
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
  const DeliveryLabel = ({ status }: { status?: "sent" | "seen" | "sending" | "failed" }) => {
    if (!status) return null;
    if (status === "seen") {
      return (
        <span className="text-[10px] text-purple-400 font-medium drop-shadow-[0_0_4px_rgba(168,85,247,0.6)]">
          Seen
        </span>
      );
    }
    if (status === "sending") {
      return <Loader2 className="w-3 h-3 text-white/30 animate-spin" />;
    }
    if (status === "failed") {
      return (
        <span className="text-[10px] text-red-400 font-medium flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Failed
        </span>
      );
    }
    return <span className="text-[10px] text-white/40">Sent</span>;
  };

  // =====================================================
  // CHAT INFO: files sent
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
  // SEND VOICE NOTE
  // =====================================================
  const handleSendVoiceNote = useCallback(async (file: File, duration: number) => {
  if (!user?.id || !conversationId) return;

  // Validate file has content
  if (!file || file.size === 0) {
    console.error("[VoiceNote] File is empty or invalid");
    toast.danger("Recording failed - no audio data");
    return;
  }

  console.log("[VoiceNote] Starting upload:", {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    duration,
  });

  setVoiceNoteUploading(true);
  setShowVoiceRecorder(false);
  setIsRecording(false);
  sendRecordingState(false);

  const tempId = `temp-voice-${Date.now()}`;
  const currentReplyingTo = replyingTo;

  // Create optimistic message with loading state
  const optimisticMsg: Message = {
    id: tempId,
    conversation_id: conversationId,
    sender_id: user.id,
    content: null,
    content_type: "media",
    created_at: new Date().toISOString(),
    is_deleted: false,
    edited_at: null,
    reply_to_id: currentReplyingTo?.id || null,
    metadata: { duration, uploading: true },
    media: [{
      id: `temp-media-${Date.now()}`,
      message_id: tempId,
      url: "",
      media_type: "audio",
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      thumbnail_url: null,
      created_at: new Date().toISOString(),
    }],
    delivery_status: "sending" as any,
    read_at: null,
    hidden_for_me: false,
    reactions: [],
    reply_to: currentReplyingTo || null,
  };

  setMessages((prev) => [...prev, optimisticMsg]);
  setReplyingTo(null);

  // Scroll to bottom
  setTimeout(() => scrollToBottom(false), 100);

  try {
    // Determine file extension
    let ext = file.name.split(".").pop()?.toLowerCase() || "m4a";
    if (ext === "aac" || ext === "mp4") ext = "m4a";
    else if (ext === "opus") ext = "webm";
    
    const path = `messages/${conversationId}/${Date.now()}_voice.${ext}`;

    // Determine content type
    let contentType = file.type;
    if (!contentType || contentType === "application/octet-stream") {
      if (ext === "m4a" || ext === "aac") contentType = "audio/mp4";
      else if (ext === "webm") contentType = "audio/webm";
      else if (ext === "mp3") contentType = "audio/mpeg";
      else if (ext === "ogg") contentType = "audio/ogg";
      else contentType = "audio/mp4";
    }

    console.log("[VoiceNote] Uploading to path:", path, "contentType:", contentType);

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("message-media")
      .upload(path, file, {
        contentType,
        cacheControl: "3600",
      });

    if (uploadError) {
      console.error("[VoiceNote] Upload error:", uploadError);
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    console.log("[VoiceNote] Upload successful, getting public URL...");

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("message-media")
      .getPublicUrl(path);

    if (!urlData?.publicUrl) {
      throw new Error("Failed to get public URL after upload");
    }

    console.log("[VoiceNote] Public URL:", urlData.publicUrl);

    // Insert message into database
    const { data: newMsg, error: msgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: null,
        content_type: "media",
        reply_to_id: currentReplyingTo?.id || null,
        metadata: { duration },
      })
      .select()
      .single();

    if (msgError) {
      console.error("[VoiceNote] Message insert error:", msgError);
      throw new Error(`Message insert failed: ${msgError.message}`);
    }

    console.log("[VoiceNote] Message created with ID:", newMsg.id);

    // Insert media record - THIS IS CRITICAL
    const { data: mediaData, error: mediaError } = await supabase
      .from("message_media")
      .insert({
        message_id: newMsg.id,
        url: urlData.publicUrl,
        media_type: "audio",
        file_name: file.name,
        file_size: file.size,
        mime_type: contentType,
      })
      .select()
      .single();

    if (mediaError) {
      console.error("[VoiceNote] Media record insert error:", mediaError);
      // Delete the orphaned message since media failed
      await supabase.from("messages").delete().eq("id", newMsg.id);
      throw new Error(`Media record failed: ${mediaError.message}`);
    }

    console.log("[VoiceNote] Media record created:", mediaData);

    // Update optimistic message with real data
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === tempId
          ? {
              ...newMsg,
              media: [{
                id: mediaData.id,
                message_id: newMsg.id,
                url: urlData.publicUrl,
                media_type: "audio" as const,
                file_name: file.name,
                file_size: file.size,
                mime_type: contentType,
                thumbnail_url: null,
                created_at: mediaData.created_at || new Date().toISOString(),
              }],
              delivery_status: "sent" as const,
              read_at: null,
              hidden_for_me: false,
              reactions: [],
              reply_to: currentReplyingTo || null,
              metadata: { duration },
            }
          : msg
      )
    );

    // Update conversation last message
    await supabase
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_message_text: "🎤 Voice message",
        last_message_sender_id: user.id,
      })
      .eq("id", conversationId);

    // Notify other user
    if (otherUser) {
      notifyDMMessage(
        otherUser.id,
        user.full_name || "Someone",
        "🎤 Voice message",
        conversationId
      );
    }

    console.log("[VoiceNote] Send complete!");

  } catch (e: any) {
    console.error("[VoiceNote] Send failed:", e);

    // Remove the failed optimistic message
    setMessages((prev) => prev.filter((msg) => msg.id !== tempId));

    toast.danger(e.message || "Failed to send voice note");
  } finally {
    setVoiceNoteUploading(false);
  }
}, [user, conversationId, replyingTo, otherUser, scrollToBottom, toast, sendRecordingState]);
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

    // If editing, handle separately
    if (editingMessage) {
      setSending(true);
      try {
        const editorHTML = getEditorHTML();
        const markdownContent = editorHTML ? htmlToMarkdown(editorHTML) : null;
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
      } catch (e: any) {
        console.error("Edit error:", e?.message || e);
        toast.danger("Failed to edit message");
      } finally {
        setSending(false);
      }
      return;
    }

    // Capture current state before clearing
    const mediaToSend = [...pendingMedia];
    const editorHTML = getEditorHTML();
    const markdownContent = editorHTML ? htmlToMarkdown(editorHTML) : null;
    const currentReplyingTo = replyingTo;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let contentType = "text";
    if (mediaToSend.length > 0) {
      contentType = mediaToSend.some(
        (m) => m.type.startsWith("image/") || m.type.startsWith("video/")
      )
        ? "media"
        : "document";
      if (mediaToSend.every((m) => m.type.startsWith("audio/"))) {
        contentType = "media";
      }
    }

    const optimisticMedia: MessageMediaItem[] = mediaToSend.map((m, i) => ({
      id: `temp-media-${i}-${Date.now()}`,
      message_id: tempId,
      url: m.preview || "",
      media_type: (m.type.startsWith("image/")
        ? "image"
        : m.type.startsWith("video/")
        ? "video"
        : m.type.startsWith("audio/")
        ? "audio"
        : "document") as "image" | "video" | "document" | "audio",
      file_name: m.file.name,
      file_size: m.file.size,
      mime_type: null,
      thumbnail_url: null,
      created_at: new Date().toISOString(),
    }));

    const optimisticMsg: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content: markdownContent || null,
      content_type: contentType as "text" | "media" | "document" | "post_share" | "system",
      created_at: new Date().toISOString(),
      is_deleted: false,
      edited_at: null,
      reply_to_id: currentReplyingTo?.id || null,
      metadata: {},
      media: optimisticMedia,
      delivery_status: "sending" as any,
      read_at: null,
      hidden_for_me: false,
      reactions: [],
      reply_to: currentReplyingTo || null,
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    // Clear input immediately
    clearEditor();
    setPendingMedia([]);
    setReplyingTo(null);

    if (mediaToSend.length > 0) {
      setUploadingMsgIds((prev) => new Map(prev).set(tempId, 0));
    }

    // Background send
    try {
      let mediaItems: { url: string; media_type: string; file_name: string; file_size: number }[] = [];

      if (mediaToSend.length > 0) {
  const { compressImage, compressVideo } = await import("@/lib/mediaCompression");

  for (let i = 0; i < mediaToSend.length; i++) {
    const media = mediaToSend[i];
    let fileToUpload = media.file;
    let uploadToCloudinary = false;
    let cloudinaryUrl = "";

    try {
      // Compress images client-side
      if (media.type.startsWith("image/")) {
        toast.info("Processing image...", 2000);
        
        fileToUpload = await compressImage(media.file, (progress) => {
          const overallProgress = Math.round(
            ((i + progress / 100) / mediaToSend.length) * 100
          );
          setUploadingMsgIds((prev) => new Map(prev).set(tempId, overallProgress));
        });
      }

      // Compress videos via Cloudinary
      if (media.type.startsWith("video/")) {
        const sizeMB = media.file.size / 1024 / 1024;
        
        if (sizeMB > 16) {
         toast.info("Processing video...", 3000);
          
          try {
            const result = await compressVideo(media.file, (progress) => {
              const overallProgress = Math.round(
                ((i + progress / 100) / mediaToSend.length) * 100
              );
              setUploadingMsgIds((prev) => new Map(prev).set(tempId, overallProgress));
            });

            uploadToCloudinary = true;
            cloudinaryUrl = result.url;
            
            console.log("[Upload] Video compressed via Cloudinary:", {
              original: `${sizeMB.toFixed(2)}MB`,
              compressed: `${(result.size / 1024 / 1024).toFixed(2)}MB`,
            });
          } catch (error: any) {
            if (error.message !== "SKIP_COMPRESSION") {
              throw error;
            }
            // Video under limit, upload normally
          }
        }
      }

      let mediaUrl = "";
      let finalFileSize = fileToUpload.size;

      // Upload to Cloudinary or Supabase Storage
      if (uploadToCloudinary) {
        mediaUrl = cloudinaryUrl;
      } else {
        const ext = fileToUpload.name.split(".").pop() || "file";
        const path = `messages/${conversationId}/${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("message-media")
          .upload(path, fileToUpload);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          continue;
        }

        const { data: urlData } = supabase.storage
          .from("message-media")
          .getPublicUrl(path);

        mediaUrl = urlData.publicUrl;
      }

      let mediaType = "document";
      if (media.type.startsWith("image/")) mediaType = "image";
      else if (media.type.startsWith("video/")) mediaType = "video";
      else if (media.type.startsWith("audio/")) mediaType = "audio";

      mediaItems.push({
        url: mediaUrl,
        media_type: mediaType,
        file_name: fileToUpload.name,
        file_size: finalFileSize,
      });

      const progress = Math.round(((i + 1) / mediaToSend.length) * 100);
      setUploadingMsgIds((prev) => new Map(prev).set(tempId, progress));

    } catch (error: any) {
      console.error("[Upload] Media processing error:", error);
      toast.danger(error.message || "Failed to process media");
      continue;
    }
  }
}

      const messageData: any = {
        conversation_id: conversationId,
        sender_id: user.id,
        content: markdownContent || null,
        content_type: contentType,
        reply_to_id: currentReplyingTo?.id || null,
      };

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

      const realMedia: MessageMediaItem[] = mediaItems.map((m, i) => ({
        id: `real-${i}-${Date.now()}`,
        message_id: newMsg.id,
        url: m.url,
        media_type: m.media_type as "image" | "video" | "document" | "audio",
        file_name: m.file_name,
        file_size: m.file_size,
        mime_type: null,
        thumbnail_url: null,
        created_at: new Date().toISOString(),
      }));

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempId
            ? {
                ...newMsg,
                media: realMedia,
                delivery_status: "sent" as const,
                read_at: null,
                hidden_for_me: false,
                reactions: [],
                reply_to: currentReplyingTo || null,
              }
            : msg.id === newMsg.id
            ? prev.find((m) => m.id === tempId) ? msg : msg
            : msg
        ).filter((msg, idx, arr) => {
          return arr.findIndex((m) => m.id === msg.id) === idx;
        })
      );

      setUploadingMsgIds((prev) => {
        const next = new Map(prev);
        next.delete(tempId);
        return next;
      });

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
    } catch (e: any) {
      console.error("Send error:", e?.message || e);

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempId
            ? { ...msg, delivery_status: "failed" as any }
            : msg
        )
      );

      setUploadingMsgIds((prev) => {
        const next = new Map(prev);
        next.delete(tempId);
        return next;
      });

      toast.danger("Failed to send message");
    }
  }, [
    getEditorContent, getEditorHTML, htmlToMarkdown, pendingMedia,
    sending, user, conversationId, otherUser, editingMessage, replyingTo,
    clearEditor, toast, markAsRead,
  ]);

  // =====================================================
  // LOADING / AUTH GUARDS
  // =====================================================
  if (authLoading || !user) return null;
  if (user.is_vip === false) return null;

  if (loading && messages.length === 0) {
  return (
    <div className="flex flex-col h-full bg-[#0a0812]">
      {/* Header skeleton */}
      <header
        className="glass-header flex items-center justify-between px-4 shrink-0 z-10"
        style={{
          height: "calc(3.5rem + env(safe-area-inset-top, 0px))",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="flex items-center gap-3">
          <Skeleton className="w-5 h-5 rounded" />
          <Skeleton className="w-9 h-9 rounded-full" />
          <div>
            <Skeleton className="w-28 h-4 mb-1" />
            <Skeleton className="w-16 h-3" />
          </div>
        </div>
        <Skeleton className="w-5 h-5 rounded" />
      </header>

      {/* Messages skeleton - using flex-col-reverse like real messages */}
      <div className="flex-1 overflow-hidden px-4 py-4 flex flex-col-reverse">
        <div className="space-y-2">
          {/* Recent messages at bottom */}
          <div className="flex justify-end">
            <Skeleton className="h-10 w-32 rounded-2xl rounded-br-md" />
          </div>
          <div className="flex justify-start items-end gap-2">
            <Skeleton className="w-7 h-7 rounded-full shrink-0" />
            <Skeleton className="h-14 w-48 rounded-2xl rounded-bl-md" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-10 w-40 rounded-2xl rounded-br-md" />
          </div>
          <div className="flex justify-start items-end gap-2">
            <Skeleton className="w-7 h-7 rounded-full shrink-0" />
            <Skeleton className="h-10 w-36 rounded-2xl rounded-bl-md" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-16 w-44 rounded-2xl rounded-br-md" />
          </div>
          <div className="flex justify-start items-end gap-2">
            <Skeleton className="w-7 h-7 rounded-full shrink-0" />
            <Skeleton className="h-10 w-52 rounded-2xl rounded-bl-md" />
          </div>
        </div>
      </div>

      {/* Input skeleton */}
      <div
        className="px-3 py-2 border-t border-white/5 bg-[#0d0a14] shrink-0"
        style={{
          paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="flex items-end gap-1.5">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <Skeleton className="flex-1 h-10 rounded-2xl" />
          <Skeleton className="w-10 h-10 rounded-xl" />
          <Skeleton className="w-10 h-10 rounded-xl" />
          <Skeleton className="w-10 h-10 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

  if (!otherUser) {
  // Show skeleton while loading user
  return (
    <div className="flex flex-col h-full bg-[#0a0812]">
      <header
        className="glass-header flex items-center justify-between px-4 shrink-0 z-10"
        style={{
          height: "calc(3.5rem + env(safe-area-inset-top, 0px))",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="flex items-center gap-3">
          <Skeleton className="w-5 h-5 rounded" />
          <Skeleton className="w-9 h-9 rounded-full" />
          <div>
            <Skeleton className="w-28 h-4 mb-1" />
            <Skeleton className="w-16 h-3" />
          </div>
        </div>
        <Skeleton className="w-5 h-5 rounded" />
      </header>
      <div className="flex-1" />
    </div>
  );
}

return (
  <div className="flex flex-col h-full bg-[#0a0812]">
      {/* =====================================================
          HEADER
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
  onClick={() => {
    // Trigger exit animation then navigate
    const layout = document.querySelector('[data-chat-layout]');
    if (layout) {
      layout.classList.add('translate-x-full');
      setTimeout(() => {
        router.push("/messages", { scroll: false });
      }, 250);
    } else {
      router.push("/messages", { scroll: false });
    }
  }}
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
  {recordingUsers.length > 0 ? (
    <span className="text-red-400 flex items-center gap-1">
      <Mic className="w-3 h-3 animate-pulse" />
      Recording...
    </span>
  ) : typingUsers.length > 0 ? (
    <span className="text-primary-400 flex items-center gap-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
      typing...
    </span>
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
          MESSAGES LIST
          ===================================================== */}
      <div
  ref={messagesContainerRef}
  className="flex-1 overflow-y-auto px-4 py-4 flex flex-col-reverse"
  style={{ 
    overscrollBehavior: 'contain',
    minHeight: 0, // Important for flex children
  }}
        onClick={() => {
          // Close emoji picker when tapping messages area
          if (showEmoji) setShowEmoji(false);
          if (showAttach) { setShowAttach(false); setPlusRotated(false); }
        }}
      >

        
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
            {/* Typing indicator - appears at bottom (first in column-reverse) */}
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

            {[...messages].reverse().map((msg, idx, reversedArr) => {
              const isMine = msg.sender_id === user.id;
              // In reversed array, "previous" visually is actually next in array
              const visualPrev = idx < reversedArr.length - 1 ? reversedArr[idx + 1] : null;
              const visualNext = idx > 0 ? reversedArr[idx - 1] : null;
              const showDate = !visualPrev || getDateLabel(msg.created_at) !== getDateLabel(visualPrev.created_at);
              const showAvatar = !isMine && (!visualNext || visualNext.sender_id !== msg.sender_id);
              const isSwipingThis = swipingMsgId === msg.id;

              return (
                <div key={msg.id} data-msg-id={msg.id} className="mb-1.5">
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
                        ? "scale-[1.02]"
                        : ""
                    }`}
                    onTouchStart={(e) => {
  handleTouchStart(msg, e);
  handleSwipeStart(msg.id, e);
}}
onTouchMove={(e) => {
  handleTouchMove(e); // Add this for long press cancellation
  handleSwipeMove(msg, e);
}}
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
                        if (navigator.vibrate) navigator.vibrate(30);
                        setContextMenuMsg(msg);
                        setContextMenuPos({ x: e.clientX, y: e.clientY });
                      }
                    }}
                  >
                    {/* Swipe reply indicator — OUTSIDE the bubble, at the edge */}
                    {isSwipingThis && swipeX > 10 && !isMine && (
                      <div
                        className="absolute left-0 top-1/2 -translate-y-1/2 z-0 transition-opacity"
                        style={{
                          opacity: Math.min(swipeX / 60, 1),
                          transform: `translateY(-50%) translateX(${Math.min(swipeX - 20, 10)}px)`,
                        }}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${swipeX > 60 ? "bg-primary-600/40" : "bg-primary-600/20"}`}>
                          <Reply className={`w-4 h-4 transition-colors ${swipeX > 60 ? "text-primary-300" : "text-primary-400"}`} />
                        </div>
                      </div>
                    )}
                    {isSwipingThis && swipeX > 10 && isMine && (
                      <div
                        className="absolute right-0 top-1/2 -translate-y-1/2 z-0 transition-opacity"
                        style={{
                          opacity: Math.min(swipeX / 60, 1),
                          transform: `translateY(-50%) translateX(-${Math.min(swipeX - 20, 10)}px)`,
                        }}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${swipeX > 60 ? "bg-primary-600/40" : "bg-primary-600/20"}`}>
                          <Reply className={`w-4 h-4 transition-colors ${swipeX > 60 ? "text-primary-300" : "text-primary-400"}`} />
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

                    {/* Message bubble */}
                        <div
                      className={`max-w-[75%] relative z-[1] ${
                        highlightedMsgId === msg.id
                          ? "ring-2 ring-purple-500/60 rounded-2xl shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                          : ""
                      }`}
                      style={{
                        transform: isSwipingThis
                          ? `translateX(${isMine ? -swipeX : swipeX}px)`
                          : undefined,
                        transition: isSwipingThis
                          ? "none"
                          : "transform 200ms ease-out",
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
                            {/* Media — single tap to open */}
                            {msg.media && msg.media.length > 0 && (
                              <div className="mb-2 space-y-2">
                                {msg.media.map((m) => (
                                  <div key={m.id}>
                                    {m.media_type === "image" && (
  <>
    {m.url ? (
      <img
        src={m.url}
        alt=""
        className="rounded-xl max-w-full max-h-60 object-cover cursor-pointer active:scale-[0.98] transition-transform"
        onClick={(e) => {
          e.stopPropagation();
          setLightboxImage(m.url);
        }}
        onTouchEnd={(e) => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }}
      />
    ) : (
      <div
        className={`flex items-center gap-3 p-4 rounded-xl ${
          isMine ? "bg-white/10" : "bg-white/5"
        }`}
      >
        <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0">
          <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-white/60">Uploading image...</p>
          <p className="text-[10px] text-white/40 truncate">{m.file_name}</p>
        </div>
      </div>
    )}
  </>
)}
                                    {m.media_type === "video" && (
  <>
    {m.url ? (
      <div
        className="cursor-pointer active:scale-[0.98] transition-transform relative"
        onClick={(e) => {
          e.stopPropagation();
          setLightboxVideo(m.url);
        }}
        onTouchEnd={(e) => {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }}
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
    ) : (
      <div
        className={`flex items-center gap-3 p-4 rounded-xl ${
          isMine ? "bg-white/10" : "bg-white/5"
        }`}
      >
        <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0">
          <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-white/60">Uploading video...</p>
          <p className="text-[10px] text-white/40 truncate">{m.file_name}</p>
        </div>
      </div>
    )}
  </>
)}
                                    {m.media_type === "audio" && (
  <>
    {m.url ? (
      <VoiceNotePlayer
        src={m.url}
        duration={msg.metadata?.duration}
        isMine={isMine}
        fileName={m.file_name || undefined}
      />
    ) : (
      <div
        className={`flex items-center gap-3 p-3 rounded-2xl min-w-[200px] ${
          isMine ? "bg-white/10" : "bg-white/5"
        }`}
      >
        <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0">
          <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-white/60">Uploading voice note...</p>
        </div>
      </div>
    )}
  </>
)}
                                    {m.media_type === "document" && (
                                      <a
                                        href={m.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/post/${msg.metadata.post_id}`);
                                }}
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

                            {/* Upload progress */}
                            {isMine && uploadingMsgIds.has(msg.id) && (
                              <div className="flex items-center gap-2 mt-1.5">
                                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary-400 rounded-full transition-all duration-300"
                                    style={{ width: `${uploadingMsgIds.get(msg.id) || 0}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-white/40 shrink-0">
                                  {uploadingMsgIds.get(msg.id) || 0}%
                                </span>
                              </div>
                            )}

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
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleReaction(msg.id, emoji);
                                    }}
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all active:scale-90 ${
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
        <div className="px-4 py-2 border-t border-primary-500/20 bg-primary-600/5 flex items-center justify-between animate-in slide-in-from-bottom-2 duration-150">
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
            className="p-1 rounded-lg hover:bg-white/10 active:scale-90 transition-transform"
          >
            <X className="w-4 h-4 text-dark-400" />
          </button>
        </div>
      )}

      {/* =====================================================
          EDITING BANNER
          ===================================================== */}
      {editingMessage && !isBlocked && (
        <div className="px-4 py-2 border-t border-primary-500/20 bg-primary-600/5 flex items-center justify-between animate-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center gap-2 min-w-0">
            <Pencil className="w-4 h-4 text-primary-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-primary-400 font-medium">Editing message</p>
              <p className="text-xs text-dark-400 truncate">{editingMessage.content?.slice(0, 60)}</p>
            </div>
          </div>
          <button
            onClick={() => { setEditingMessage(null); clearEditor(); }}
            className="p-1 rounded-lg hover:bg-white/10 active:scale-90 transition-transform"
          >
            <X className="w-4 h-4 text-dark-400" />
          </button>
        </div>
      )}

      {/* =====================================================
          PENDING MEDIA PREVIEW
          ===================================================== */}
      {pendingMedia.length > 0 && (
        <div className="px-4 py-2 border-t border-white/5 bg-[#0d0a14] animate-in slide-in-from-bottom-2 duration-150">
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
        <div className="px-4 py-2 border-t border-white/5 bg-[#0d0a14] flex items-center justify-center gap-3 animate-in slide-in-from-bottom-2 duration-100">
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
        <div className="px-4 py-3 border-t border-white/5 bg-[#0d0a14] space-y-2 animate-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between">
            <p className="text-xs text-dark-400 font-medium">Insert Link</p>
            <button onClick={() => { setShowLinkInput(false); setLinkUrl(""); setLinkText(""); }} className="p-1 rounded-lg hover:bg-white/10 text-dark-400 active:scale-90 transition-transform">
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
          EMOJI PICKER — with fixed X button
          ===================================================== */}
      {showEmoji && !isBlocked && (
        <div className="border-t border-white/10 bg-[#0d0a14] flex flex-col shrink-0 animate-in slide-in-from-bottom-3 duration-200" style={{ maxHeight: "40vh" }}>
          {/* Fixed header with tabs and X */}
          <div className="flex items-center gap-0.5 px-2 py-2 border-b border-white/5 shrink-0">
            <div className="flex-1 flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
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
            </div>
            <button
              onClick={() => setShowEmoji(false)}
              className="p-2 rounded-lg hover:bg-white/10 text-dark-400 shrink-0 ml-1 active:scale-90 transition-transform"
            >
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
                    <div className={`flex items-end gap-1.5 ${showVoiceRecorder ? "hidden" : ""}`}>
            {/* Plus / Attach button with rotation animation */}
            <div className="relative shrink-0">
              <button
                onClick={() => {
                  const next = !showAttach;
                  setShowAttach(next);
                  setPlusRotated(next);
                  setShowEmoji(false);
                  setShowLinkInput(false);
                }}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 text-dark-400 hover:text-white active:scale-90 transition-all"
              >
                <Plus
                  className="w-5 h-5 transition-transform duration-300"
                  style={{ transform: plusRotated ? "rotate(135deg)" : "rotate(0deg)" }}
                />
              </button>
              {showAttach && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => { setShowAttach(false); setPlusRotated(false); }} />
                  <div className="absolute bottom-full left-0 mb-2 z-20 glass-strong rounded-xl overflow-hidden shadow-2xl border border-white/10 w-48 animate-in fade-in slide-in-from-bottom-2 duration-150">
                    <button
                      onClick={() => { fileInputRef.current?.click(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                    >
                      <div className="w-8 h-8 rounded-full bg-primary-600/20 flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-primary-400" />
                      </div>
                      <span className="text-sm text-dark-200">Photo / Video</span>
                    </button>
                    <button
                      onClick={() => { docInputRef.current?.click(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 text-left active:scale-[0.98] transition-transform"
                    >
                      <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-blue-400" />
                      </div>
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
                onFocus={() => {
                  // Close attach menu when focusing editor, but NOT emoji picker
                  if (showAttach) { setShowAttach(false); setPlusRotated(false); }
                }}
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
              onClick={() => { setShowEmoji(!showEmoji); setShowAttach(false); setPlusRotated(false); setShowFormatBar(false); setShowLinkInput(false); }}
              className={`w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all shrink-0 ${
                showEmoji ? "text-primary-400" : "text-dark-400 hover:text-white"
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>

            {isEditorEmpty() && pendingMedia.length === 0 && !editingMessage && !showVoiceRecorder ? (
              <button
                onClick={() => {
                  setShowVoiceRecorder(true);
                  setIsRecording(true);
                  setShowEmoji(false);
                  setShowAttach(false);
                  setPlusRotated(false);
                }}
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 text-dark-400 hover:text-white active:scale-90 transition-all shrink-0"
              >
                <Mic className="w-5 h-5" />
              </button>
            ) : !showVoiceRecorder ? (
              <button
                onClick={handleSend}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary-600 hover:bg-primary-500 text-white active:scale-90 transition-all shrink-0"
              >
                <Send className="w-5 h-5" />
              </button>
            ) : null}
          </div>

          {/* Voice Note Recorder */}
          {showVoiceRecorder && (
            <div className="mt-2">
              <VoiceNoteRecorder
                onRecordingStart={handleRecordingStart}
                onRecordingEnd={handleRecordingEnd}
                onCancel={handleRecordingCancel}
                onSend={handleSendVoiceNote}
                isUploading={voiceNoteUploading}
              />
            </div>
          )}
        </div>
      )}

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileSelect} />
      <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.txt,.xlsx,.xls,.pptx,.ppt,.zip,.rar" multiple className="hidden" onChange={handleFileSelect} />

      {/* =====================================================
          CONTEXT MENU — Premium WhatsApp-style with blur backdrop
          ===================================================== */}
      {contextMenuMsg && contextMenuPos && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] animate-in fade-in duration-150"
            style={{ backdropFilter: "blur(8px)", backgroundColor: "rgba(0,0,0,0.5)" }}
            onClick={() => { setContextMenuMsg(null); setContextMenuPos(null); }}
          >
            {/* Floating message preview */}
            <div
              className="absolute animate-in zoom-in-95 fade-in duration-200"
              style={{
                left: contextMenuMsg.sender_id === user.id ? "auto" : 16,
                right: contextMenuMsg.sender_id === user.id ? 16 : "auto",
                top: Math.min(Math.max(contextMenuPos.y - 60, 60), window.innerHeight - 350),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Quick Reactions row */}
              {!contextMenuMsg.is_deleted && (
                <div className="flex items-center gap-1 mb-2 px-1">
                  {QUICK_REACTIONS.map((emoji) => {
                    const hasReacted = contextMenuMsg.reactions?.some(
                      (r) => r.emoji === emoji && r.user_id === user.id
                    );
                    return (
                      <button
                        key={emoji}
                        onClick={() => toggleReaction(contextMenuMsg.id, emoji)}
                        className={`text-2xl hover:scale-125 active:scale-90 transition-all p-1.5 rounded-full ${
                          hasReacted ? "bg-primary-600/30 scale-110" : "hover:bg-white/10"
                        }`}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setReactionPickerMsgId(contextMenuMsg.id);
                      setReactionPickerTab("smileys");
                      setContextMenuMsg(null);
                      setContextMenuPos(null);
                    }}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 border border-white/10 hover:bg-white/10 active:scale-90 transition-all ml-1"
                  >
                    <Plus className="w-4 h-4 text-dark-300" />
                  </button>
                </div>
              )}

              {/* Action menu */}
              <div className="glass-strong rounded-2xl overflow-hidden shadow-2xl border border-white/10 w-56 animate-in slide-in-from-bottom-2 duration-200">
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

                <div className="h-px bg-white/5" />

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
            className="fixed inset-0 z-[99999] flex flex-col justify-end animate-in fade-in duration-150"
            style={{ backdropFilter: "blur(4px)", backgroundColor: "rgba(0,0,0,0.4)" }}
            onClick={() => setReactionPickerMsgId(null)}
          >
            <div
              className="bg-[#0d0a14] border-t border-white/10 rounded-t-3xl max-h-[50vh] flex flex-col animate-in slide-in-from-bottom-4 duration-300"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-0.5 px-2 py-2 border-b border-white/5 shrink-0">
                <div className="flex-1 flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
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
                </div>
                <button
                  onClick={() => setReactionPickerMsgId(null)}
                  className="p-2 rounded-lg hover:bg-white/10 text-dark-400 shrink-0 ml-1 active:scale-90 transition-transform"
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
            className="fixed inset-0 z-[99999] flex items-center justify-center animate-in fade-in duration-200"
            style={{ backdropFilter: "blur(12px)", backgroundColor: "rgba(0,0,0,0.7)" }}
            onClick={(e) => {
              e.stopPropagation();
              setAvatarPreview(null);
            }}
          >
            <div className="animate-in zoom-in-90 duration-300" onClick={(e) => e.stopPropagation()}>
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