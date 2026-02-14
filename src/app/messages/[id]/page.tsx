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
  Link2,
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
  const [pendingMedia, setPendingMedia] = useState<{ file: File; preview: string; type: string }[]>([]);

  // ------ Long Press / Context Menu ------
  const [contextMenuMsg, setContextMenuMsg] = useState<Message | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);

  // ------ Edit Mode ------
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  // ------ Lightbox ------
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxVideo, setLightboxVideo] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // ------ Voice Note ------
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

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
      setLoading(true);
      try {
        // Get participants
        const { data: participants, error: pErr } = await supabase
          .from("conversation_participants")
          .select("user_id, is_muted, is_blocked")
          .eq("conversation_id", conversationId);
        if (pErr) throw pErr;

        const myP = participants?.find((p) => p.user_id === user.id);
        const otherP = participants?.find((p) => p.user_id !== user.id);
        if (!otherP) { router.replace("/messages"); return; }

        setIsMuted(myP?.is_muted || false);
        setIsBlocked(myP?.is_blocked || false);

        // Get other user profile
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

        // Fetch my deletions for this conversation
        const { data: myDeletions } = await supabase
          .from("message_deletions")
          .select("message_id")
          .eq("user_id", user.id);
        myDeletionsRef.current = new Set((myDeletions || []).map((d: any) => d.message_id));

        await fetchMessages();
        await markAsRead();
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

    const online = presenceManager.isOnline(otherUser.id);
    setOtherUserOnline(online);
    otherUserOnlineRef.current = online;

    const unsub = presenceManager.onStatusChange((userId, isOnline) => {
      if (userId === otherUser.id) {
        setOtherUserOnline(isOnline);
        otherUserOnlineRef.current = isOnline;
      }
    });

    return unsub;
  }, [otherUser?.id]);

  // =====================================================
  // FETCH MESSAGES
  // =====================================================
  const fetchMessages = useCallback(async () => {
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

    const deletedForMe = myDeletionsRef.current;

    setMessages(
      msgs
        .filter((m) => !deletedForMe.has(m.id))
        .map((m) => {
          let deliveryStatus: "sent" | "delivered" | "read" = "sent";
          if (m.sender_id === user.id) {
            if (readMap[m.id]) {
              deliveryStatus = "read";
            } else {
              // If message exists in DB, it's at least delivered
              // "sent" is only for optimistic local messages
              deliveryStatus = "delivered";
            }
          }
          return {
            ...m,
            media: mediaMap[m.id] || [],
            delivery_status: deliveryStatus,
            read_at: m.sender_id === user.id ? readMap[m.id] || null : null,
            hidden_for_me: false,
          };
        })
    );
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
   useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      if (!initialScrollDone.current) {
        // Use instant scroll + RAF to ensure DOM is rendered
        messagesEndRef.current.scrollIntoView();
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView();
        });
        initialScrollDone.current = true;
      } else {
        const c = messagesContainerRef.current;
        if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 150) {
          messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }
    }
  }, [messages]);

  // =====================================================
  // REALTIME: Messages + Read receipts + Deletions
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

          // Skip if deleted for me
          if (myDeletionsRef.current.has(newMsg.id)) return;

          let media: MessageMediaItem[] = [];
          if (newMsg.content_type === "media" || newMsg.content_type === "document") {
            // Small delay to ensure media records are inserted before we query
            await new Promise((r) => setTimeout(r, 500));
            const { data } = await supabase
              .from("message_media")
              .select("*")
              .eq("message_id", newMsg.id);
            media = (data || []) as MessageMediaItem[];
          }

          setMessages((prev) => {
            // If message already exists (from optimistic insert), upgrade its status
            const existing = prev.find((m) => m.id === newMsg.id);
            if (existing) {
              return prev.map((m) =>
                m.id === newMsg.id
                  ? { ...m, media: media.length > 0 ? media : m.media, delivery_status: "delivered" as const }
                  : m
              );
            }
            return [
              ...prev,
              {
                ...newMsg,
                media,
                delivery_status: newMsg.sender_id === user.id ? "delivered" as const : undefined,
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
          if (read.user_id !== user.id) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === read.message_id
                  ? { ...m, delivery_status: "read" as const, read_at: read.read_at }
                  : m
              )
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
  // Update delivery status when other user comes online
  // =====================================================
  useEffect(() => {
    if (!otherUserOnline) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.sender_id === user?.id && m.delivery_status === "sent") {
          return { ...m, delivery_status: "delivered" as const };
        }
        return m;
      })
    );
  }, [otherUserOnline, user?.id]);

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
  // GET EDITOR CONTENT (from contenteditable div)
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

  const setEditorContent = useCallback((text: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.innerText = text;
  }, []);

  const clearEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = "";
  }, []);

  const isEditorEmpty = useCallback((): boolean => {
    const el = editorRef.current;
    if (!el) return true;
    const text = el.innerText.trim();
    return text.length === 0;
  }, []);

  // =====================================================
  // RENDER MESSAGE CONTENT
  // =====================================================
  const renderContent = useCallback((content: string | null) => {
    if (!content) return null;

    // Convert stored markdown-style formatting to HTML
    let html = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Bold: **text**
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Italic: *text*
    html = html.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    // Code: `text`
    html = html.replace(
      /`(.*?)`/g,
      '<code class="px-1 py-0.5 rounded bg-white/10 text-xs font-mono">$1</code>'
    );
    // URLs - only match if not already inside an anchor tag
    html = html.replace(
      /(?<!href=["'])(?<!>)(https?:\/\/[^\s<)]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary-400 underline hover:text-primary-300 break-all">$1</a>'
    );
    // Bullet lists: lines starting with - or •
    html = html.replace(
      /^[-•]\s+(.+)$/gm,
      '<div class="flex gap-2 items-start"><span class="text-primary-400 mt-0.5">•</span><span>$1</span></div>'
    );
    // Numbered lists: lines starting with N.
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
  // CONVERT EDITOR HTML TO MARKDOWN FOR STORAGE
  // =====================================================
  const htmlToMarkdown = useCallback((html: string): string => {
    const div = document.createElement("div");
    div.innerHTML = html;

    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || "";
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return "";

      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const childText = Array.from(el.childNodes).map(walk).join("");

      switch (tag) {
        case "b":
        case "strong":
          return `**${childText}**`;
        case "i":
        case "em":
          return `*${childText}*`;
        case "a": {
          const href = el.getAttribute("href");
          if (href && childText && childText !== href) {
            return `${childText} (${href})`;
          }
          return href || childText;
        }
        case "br":
          return "\n";
        case "div":
        case "p":
          return childText + "\n";
        case "ul":
          return childText;
        case "ol":
          return childText;
        case "li": {
          const parent = el.parentElement;
          if (parent?.tagName.toLowerCase() === "ol") {
            const idx = Array.from(parent.children).indexOf(el) + 1;
            return `${idx}. ${childText}\n`;
          }
          return `- ${childText}\n`;
        }
        default:
          return childText;
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
        toast.warning("You cannot send messages to this user");
        return;
      }
    }

    setSending(true);
    try {
      let contentType = "text";
      let mediaItems: { url: string; media_type: string; file_name: string; file_size: number }[] = [];

      // Upload pending media
      if (pendingMedia.length > 0) {
        contentType = pendingMedia.some(
          (m) => m.type.startsWith("image/") || m.type.startsWith("video/")
        )
          ? "media"
          : "document";

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

      // Convert editor HTML to markdown for storage
      const editorHTML = getEditorHTML();
      const markdownContent = editorHTML ? htmlToMarkdown(editorHTML) : null;

      const messageData: any = {
        conversation_id: conversationId,
        sender_id: user.id,
        content: markdownContent || null,
        content_type: contentType,
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

      // Insert new message
      const { data: newMsg, error: msgError } = await supabase
        .from("messages")
        .insert(messageData)
        .select()
        .single();
      if (msgError) throw msgError;

      // Insert media items
      if (mediaItems.length > 0 && newMsg) {
        await supabase.from("message_media").insert(
          mediaItems.map((m) => ({ message_id: newMsg.id, ...m }))
        );
      }

            // Optimistically add message to local state
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
            },
          ];
        });
      }

      // Update conversation
      await supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          last_message_text: markdownContent?.slice(0, 100) || (mediaItems.length > 0 ? "Sent an attachment" : null),
          last_message_sender_id: user.id,
        })
        .eq("id", conversationId);

      // Notify
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
    } catch (e: any) {
      console.error("Send error:", e?.message || e);
      toast.danger("Failed to send message");
    } finally {
      setSending(false);
    }
  }, [
    getEditorContent, getEditorHTML, htmlToMarkdown, pendingMedia,
    sending, user, conversationId, otherUser, editingMessage,
    clearEditor, toast, markAsRead,
  ]);

  // =====================================================
  // FORMAT COMMANDS (execCommand for contenteditable)
  // =====================================================
  const applyBold = () => {
    document.execCommand("bold");
    editorRef.current?.focus();
  };

  const applyItalic = () => {
    document.execCommand("italic");
    editorRef.current?.focus();
  };

  const applyBulletList = () => {
    document.execCommand("insertUnorderedList");
    editorRef.current?.focus();
  };

  const applyNumberedList = () => {
    document.execCommand("insertOrderedList");
    editorRef.current?.focus();
  };

  const openLinkInput = () => {
    const selection = window.getSelection();
    if (selection && selection.toString()) {
      setLinkText(selection.toString());
    }
    setShowLinkInput(true);
  };

  const insertLink = () => {
    if (!linkUrl.trim()) return;
    const url = linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
    const displayText = linkText || url;

    // Focus editor first, then insert
    const editor = editorRef.current;
    if (editor) {
      editor.focus();
      // Use a timeout to ensure focus is established
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

      // @ts-ignore - MediaRecorder options typing is incomplete in some TS versions
      const recorder = new MediaRecorder(stream, { mimeType });

      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());

        const recordedMimeType = mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, {
          type: recordedMimeType,
        });
        const ext = recordedMimeType.includes("webm") ? "webm" : "m4a";
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
          type: recordedMimeType,
        });
        setPendingMedia((prev) => [
          ...prev,
          { file, preview: "", type: recorder.mimeType },
        ]);

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
  // DELETE / EDIT / COPY
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
    // Strip markdown formatting for clipboard
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
    // Set editor content to the message text
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
      // Delete all messages for me
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
  // DATE SEPARATOR
  // =====================================================
  const getDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMM d, yyyy");
  };

  // =====================================================
  // DELIVERY STATUS ICON
  // =====================================================
  const DeliveryIcon = ({ status }: { status?: "sent" | "delivered" | "read" }) => {
    switch (status) {
      case "read":
        return <CheckCheck className="w-3.5 h-3.5 text-purple-400 drop-shadow-[0_0_4px_rgba(168,85,247,0.6)]" />;
      case "delivered":
        return <CheckCheck className="w-3.5 h-3.5 text-white/40" />;
      case "sent":
      default:
        return <Check className="w-3.5 h-3.5 text-white/40" />;
    }
  };

  // =====================================================
  // CHAT INFO PANEL: files sent, delete chat, block
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

    // Ctrl/Cmd+B for bold
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      applyBold();
    }
    // Ctrl/Cmd+I for italic
    if ((e.ctrlKey || e.metaKey) && e.key === "i") {
      e.preventDefault();
      applyItalic();
    }
  };

  // =====================================================
  // LOADING / AUTH GUARDS
  // =====================================================
  if (authLoading || !user) return null;
  if (user.is_vip === false) return null;

  if (loading) {
    return (
      <div className="fixed inset-0 flex flex-col bg-[#0a0812]">
        <div className="glass-header h-14 flex items-center gap-3 px-4 shrink-0">
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
    <div className="fixed inset-0 flex flex-col bg-[#0a0812]">
      {/* =====================================================
          HEADER
          ===================================================== */}
      <header className="glass-header h-14 flex items-center justify-between px-4 shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push("/messages")}
            className="p-1.5 -ml-1 hover:bg-white/5 rounded-lg active:scale-95 transition-transform"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>

          {/* Avatar — tap to preview */}
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
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-[#0a0812]" />
            )}
          </button>

          {/* Name + status — tap to open chat info */}
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
                <span className={otherUserOnline ? "text-green-400" : ""}>{lastSeenText}</span>
              )}
            </p>
          </button>
        </div>

        {/* Menu */}
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

              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-4">
                      <span className="text-[11px] text-dark-500 bg-dark-900/80 px-3 py-1 rounded-full border border-white/5">
                        {getDateLabel(msg.created_at)}
                      </span>
                    </div>
                  )}

                  <div
                    className={`flex items-end gap-2 mb-0.5 ${isMine ? "justify-end" : "justify-start"}`}
                    onTouchStart={(e) => handleTouchStart(msg, e)}
                    onTouchEnd={handleTouchEnd}
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

                    <div className="max-w-[75%] relative">
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
                        <div
                          className={`px-4 py-2.5 rounded-2xl ${
                            isMine
                              ? "bg-primary-600/90 text-white rounded-br-md"
                              : "bg-[#1a1525] border border-white/5 text-dark-100 rounded-bl-md"
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
                                      className="cursor-pointer active:scale-[0.98] transition-transform"
                                      onClick={() => setLightboxVideo(m.url)}
                                    >
                                      <video
                                        src={m.url}
                                        className="rounded-xl max-w-full max-h-60"
                                        preload="metadata"
                                      />
                                      <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                                          <div className="w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-l-[14px] border-l-white ml-1" />
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  {(m.media_type === "document" || m.media_type === "audio") && (
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
                                        {m.media_type === "audio" ? "🎵" : getDocIcon(m.file_name)}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium truncate">
                                          {m.file_name || (m.media_type === "audio" ? "Voice note" : "Document")}
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
                          <div className={`flex items-center gap-1 mt-1.5 ${isMine ? "justify-end" : "justify-start"}`}>
                            <span className={`text-[10px] ${isMine ? "text-white/50" : "text-dark-500"}`}>
                              {format(new Date(msg.created_at), "HH:mm")}
                            </span>
                            {msg.edited_at && (
                              <span className={`text-[10px] ${isMine ? "text-white/40" : "text-dark-600"}`}>
                                · edited
                              </span>
                            )}
                            {isMine && <DeliveryIcon status={msg.delivery_status} />}
                          </div>
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
          <button onClick={applyBold} className="p-2.5 rounded-lg hover:bg-white/10 active:scale-90 text-dark-300 hover:text-white transition-all" title="Bold">
            <Bold className="w-4 h-4" />
          </button>
          <button onClick={applyItalic} className="p-2.5 rounded-lg hover:bg-white/10 active:scale-90 text-dark-300 hover:text-white transition-all" title="Italic">
            <Italic className="w-4 h-4" />
          </button>
          <button onClick={openLinkInput} className="p-2.5 rounded-lg hover:bg-white/10 active:scale-90 text-dark-300 hover:text-white transition-all" title="Link">
            <Link2 className="w-4 h-4" />
          </button>
          <button onClick={applyBulletList} className="p-2.5 rounded-lg hover:bg-white/10 active:scale-90 text-dark-300 hover:text-white transition-all" title="Bullets">
            <List className="w-4 h-4" />
          </button>
          <button onClick={applyNumberedList} className="p-2.5 rounded-lg hover:bg-white/10 active:scale-90 text-dark-300 hover:text-white transition-all" title="Numbers">
            <ListOrdered className="w-4 h-4" />
          </button>
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
          EMOJI PICKER
          ===================================================== */}
      {showEmoji && !isBlocked && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] flex flex-col justify-end"
            onClick={(e) => { if (e.target === e.currentTarget) setShowEmoji(false); }}
          >
            <div className="bg-[#0d0a14] border-t border-white/10 rounded-t-3xl max-h-[50vh] flex flex-col animate-[slideUp_200ms_ease-out]">
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
          </div>,
          document.body
        )}

      {/* =====================================================
          INPUT BAR
          ===================================================== */}
      {!isBlocked && (
        <div
          className="px-3 py-2 border-t border-white/5 bg-[#0d0a14]"
          style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="flex items-end gap-1.5">
            {/* Attach */}
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

            {/* WYSIWYG Editor */}
            <div className="flex-1 min-w-0">
              <div
                ref={editorRef}
                contentEditable
                role="textbox"
                aria-multiline="true"
                data-placeholder={editingMessage ? "Edit message..." : "Message..."}
                onInput={() => sendTyping()}
                onKeyDown={handleEditorKeyDown}
                className="w-full bg-[#1a1525] border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-dark-100 focus:outline-none focus:border-primary-500/40 resize-none transition-colors overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-dark-500 empty:before:pointer-events-none [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_a]:text-primary-400 [&_a]:underline [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4"
                style={{ minHeight: 40, maxHeight: 120 }}
                suppressContentEditableWarning
              />
            </div>

            {/* Format toggle */}
            <button
              onClick={() => { setShowFormatBar(!showFormatBar); setShowEmoji(false); setShowLinkInput(false); }}
              className={`w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all shrink-0 ${
                showFormatBar ? "text-primary-400" : "text-dark-400 hover:text-white"
              }`}
            >
              <Bold className="w-4 h-4" />
            </button>

            {/* Emoji */}
            <button
              onClick={() => { setShowEmoji(!showEmoji); setShowAttach(false); setShowFormatBar(false); setShowLinkInput(false); }}
              className={`w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/10 active:scale-90 transition-all shrink-0 ${
                showEmoji ? "text-primary-400" : "text-dark-400 hover:text-white"
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>

            {/* Voice note / Send */}
            {isEditorEmpty() && pendingMedia.length === 0 && !editingMessage ? (
              // Voice note button
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
              // Send button
              <button
                onClick={handleSend}
                disabled={sending}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary-600 hover:bg-primary-500 text-white active:scale-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            )}
          </div>

          {/* Recording indicator */}
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
          CONTEXT MENU (Long Press Menu)
          ===================================================== */}
      {contextMenuMsg && contextMenuPos && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[99999]" onClick={() => setContextMenuMsg(null)}>
            <div
              className="absolute glass-strong rounded-xl overflow-hidden shadow-2xl border border-white/10 w-52 animate-in fade-in zoom-in-95 duration-150"
              style={{
                left: Math.min(contextMenuPos.x, window.innerWidth - 220),
                top: Math.min(contextMenuPos.y - 10, window.innerHeight - 300),
              }}
              onClick={(e) => e.stopPropagation()}
            >
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

              {/* Edit (own messages only, text only) */}
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

              {/* Delete for everyone (own messages only) */}
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
          AVATAR PREVIEW (Circle, WhatsApp-style)
          ===================================================== */}
      {avatarPreview && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setAvatarPreview(null)}
          >
            <div className="animate-in fade-in zoom-in-90 duration-200">
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
            {/* Header */}
            <header className="glass-header h-14 flex items-center gap-3 px-4 shrink-0">
              <button
                onClick={() => setShowChatInfo(false)}
                className="p-1.5 -ml-1 hover:bg-white/5 rounded-lg active:scale-95 transition-transform"
              >
                <ArrowLeft className="w-5 h-5 text-dark-200" />
              </button>
              <h2 className="text-sm font-semibold text-dark-100">Chat Info</h2>
            </header>

            <div className="flex-1 overflow-y-auto">
              {/* Profile section */}
              <div className="flex flex-col items-center py-8 px-4">
                <button
                  onClick={() => {
                    if (otherUser?.avatar_url) {
                      setShowChatInfo(false);
                      setAvatarPreview(otherUser.avatar_url);
                    }
                  }}
                  className="w-24 h-24 rounded-full overflow-hidden bg-dark-800 border-2 border-white/10 mb-3"
                >
                  {otherUser?.avatar_url ? (
                    <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-12 h-12 text-dark-400 m-auto mt-5" />
                  )}
                </button>
                <h3 className="text-lg font-semibold text-dark-100 flex items-center gap-2">
                  {otherUser?.full_name || "Unknown"}
                  {otherUser?.is_admin && <Crown className="w-4 h-4 text-yellow-400" />}
                </h3>
                <p className="text-sm text-dark-400">{otherUser?.email}</p>
                <p className={`text-xs mt-1 ${otherUserOnline ? "text-green-400" : "text-dark-500"}`}>
                  {lastSeenText}
                </p>
              </div>

              {/* Shared media */}
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
                            onClick={() => { setLightboxImage(m.url); }}
                            className="w-full aspect-square rounded-lg overflow-hidden bg-dark-800"
                          >
                            <img src={m.url} alt="" className="w-full h-full object-cover" />
                          </button>
                        ) : m.media_type === "video" ? (
                           <button
                            onClick={() => { setLightboxVideo(m.url); }}
                            className="w-full aspect-square rounded-lg overflow-hidden bg-dark-800 relative"
                          >
                            <video src={m.url} className="w-full h-full object-cover" preload="metadata" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <div className="w-6 h-6 rounded-full bg-white/80 flex items-center justify-center">
                                <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[7px] border-l-black ml-0.5" />
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
                            <span className="text-lg">{getDocIcon(m.file_name)}</span>
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

              {/* Actions */}
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