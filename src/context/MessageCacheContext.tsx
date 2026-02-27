"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthContext";
import type { Conversation, VIPUser, Message } from "@/lib/types";

// =====================================================
// TYPES
// =====================================================

export type ConversationWithUser = Conversation & {
  other_user: VIPUser;
  unread_count: number;
  last_message_seen?: boolean;
};

type ChatListener = {
  onMessageInsert: (msg: any) => void;
  onMessageUpdate: (msg: any) => void;
  onReactionChange: (messageId: string, reactions: any[]) => void;
  onReadReceipt: (data: { message_id: string; user_id: string; read_at: string }) => void;
  onParticipantUpdate: (data: any) => void;
};

interface MessageCacheContextValue {
  conversations: ConversationWithUser[];
  conversationsLoading: boolean;
  fetchConversations: () => Promise<void>;
  setConversations: React.Dispatch<React.SetStateAction<ConversationWithUser[]>>;

  // Badge management — these are the ONLY way to modify unread counts
  clearUnread: (conversationId: string) => void;
  markConversationRead: (conversationId: string) => void;
  updateLastMessage: (conversationId: string, text: string, senderId: string) => void;

  // Chat page integration
  subscribeToChat: (conversationId: string, listener: ChatListener) => () => void;
  setActiveConversation: (conversationId: string | null) => void;
  activeConversationId: string | null;

  // UI state shared across pages
  recordingConversationId: string | null;
  setRecordingConversationId: (id: string | null) => void;
}

const MessageCacheContext = createContext<MessageCacheContextValue | null>(null);

// =====================================================
// INDEXEDDB — cache conversation list for instant load
// =====================================================
const DB_NAME = "peja-msg-v2";
const DB_VERSION = 1;
const STORE = "convs";

function idbOpen(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => resolve(null);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
    } catch {
      resolve(null);
    }
  });
}

async function idbSave(data: ConversationWithUser[]): Promise<void> {
  const db = await idbOpen();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    data.forEach((c) => store.put(c));
  } catch {} finally {
    db.close();
  }
}

async function idbLoad(): Promise<ConversationWithUser[]> {
  const db = await idbOpen();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

// =====================================================
// HELPERS
// =====================================================
function sortByLastMessage(convs: ConversationWithUser[]): ConversationWithUser[] {
  return [...convs].sort((a, b) => {
    const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bt - at;
  });
}

// =====================================================
// PROVIDER
// =====================================================
export function MessageCacheProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [conversations, setConversations] = useState<ConversationWithUser[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeConversationId, setActiveIdState] = useState<string | null>(null);
  const [recordingConversationId, setRecordingConversationId] = useState<string | null>(null);

  // Refs
  const activeConvRef = useRef<string | null>(null);
  const channelRef = useRef<any>(null);
  const chatListenersRef = useRef<Map<string, Set<ChatListener>>>(new Map());
  const conversationsRef = useRef<ConversationWithUser[]>([]);
  const userIdRef = useRef<string | null>(null);
  const hasFetchedRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { userIdRef.current = user?.id || null; }, [user?.id]);

  // =====================================================
  // SET ACTIVE CONVERSATION
  // =====================================================
const setActiveConversation = useCallback((id: string | null) => {
    const previousId = activeConvRef.current;
    activeConvRef.current = id;
    setActiveIdState(id);
    if (typeof window !== "undefined") {
      (window as any).__pejaActiveConversationId = id;
    }

    // LEAVING a chat: update last_read_at to the latest message timestamp
    // This ensures all messages the user saw are marked as read in the DB,
    // so refreshing the page won't bring back stale badge counts.
    if (previousId && !id && userIdRef.current) {
      const userId = userIdRef.current;
      supabase
        .from("messages")
        .select("created_at")
        .eq("conversation_id", previousId)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data && data.length > 0) {
            const latestMsgTime = data[0].created_at;
            // Set last_read_at to 1 second AFTER the latest message
            // to ensure the gt() query in fetchConversations excludes it
            const readTime = new Date(
              new Date(latestMsgTime).getTime() + 1000
            ).toISOString();

            supabase
              .from("conversation_participants")
              .update({ last_read_at: readTime })
              .eq("conversation_id", previousId)
              .eq("user_id", userId)
              .then(() => {});
          }
        });
    }

    // Entering a chat: clear unread immediately
    if (id) {
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === id);
        if (!conv || conv.unread_count === 0) return prev;
        const updated = prev.map((c) =>
          c.id === id ? { ...c, unread_count: 0 } : c
        );
        idbSave(updated);
        return updated;
      });

      // Also mark as read on ENTER using latest message time
      if (userIdRef.current) {
        const userId = userIdRef.current;
        supabase
          .from("messages")
          .select("created_at")
          .eq("conversation_id", id)
          .order("created_at", { ascending: false })
          .limit(1)
          .then(({ data }) => {
            if (data && data.length > 0) {
              const readTime = new Date(
                new Date(data[0].created_at).getTime() + 1000
              ).toISOString();

              supabase
                .from("conversation_participants")
                .update({ last_read_at: readTime })
                .eq("conversation_id", id)
                .eq("user_id", userId)
                .then(() => {});
            }
          });
      }
    }
  }, []);

  // =====================================================
  // SUBSCRIBE TO CHAT (used by [id]/page.tsx)
  // =====================================================
  const subscribeToChat = useCallback((conversationId: string, listener: ChatListener): (() => void) => {
    if (!chatListenersRef.current.has(conversationId)) {
      chatListenersRef.current.set(conversationId, new Set());
    }
    chatListenersRef.current.get(conversationId)!.add(listener);
    return () => {
      const set = chatListenersRef.current.get(conversationId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) chatListenersRef.current.delete(conversationId);
      }
    };
  }, []);

  const dispatch = useCallback((conversationId: string, action: (l: ChatListener) => void) => {
    const listeners = chatListenersRef.current.get(conversationId);
    if (!listeners) return;
    listeners.forEach((l) => { try { action(l); } catch {} });
  }, []);

  // =====================================================
  // LOAD CACHED CONVERSATIONS (instant display)
  // =====================================================
  useEffect(() => {
    if (!user?.id) return;
    idbLoad().then((cached) => {
      if (cached.length > 0) {
        setConversations(cached);
        setConversationsLoading(false);
      }
    });
  }, [user?.id]);

  // =====================================================
  // FETCH CONVERSATIONS FROM DB
  // Called ONCE on mount. After that, only realtime updates.
  // =====================================================
  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;

    try {
      // 1. My participation
      const { data: myParts, error: e1 } = await supabase
        .from("conversation_participants")
        .select("conversation_id, last_read_at, is_blocked, is_muted")
        .eq("user_id", user.id);

      if (e1) throw e1;
      if (!myParts || myParts.length === 0) {
        setConversations([]);
        setConversationsLoading(false);
        return;
      }

      const convIds = myParts.map((p) => p.conversation_id);
      const myPartMap: Record<string, { last_read_at: string }> = {};
      myParts.forEach((p) => { myPartMap[p.conversation_id] = { last_read_at: p.last_read_at }; });

      // 2. Conversations + other participants + users in parallel
      const [convRes, otherPartRes] = await Promise.all([
        supabase.from("conversations").select("*").in("id", convIds),
        supabase.from("conversation_participants")
          .select("conversation_id, user_id, last_read_at")
          .in("conversation_id", convIds)
          .neq("user_id", user.id),
      ]);

      if (convRes.error) throw convRes.error;
      if (otherPartRes.error) throw otherPartRes.error;

      const otherUserMap: Record<string, string> = {};
      const otherReadMap: Record<string, string> = {};
      (otherPartRes.data || []).forEach((p) => {
        otherUserMap[p.conversation_id] = p.user_id;
        otherReadMap[p.conversation_id] = p.last_read_at;
      });

      const otherUserIds = [...new Set(Object.values(otherUserMap))];
      let usersMap: Record<string, VIPUser> = {};
      if (otherUserIds.length > 0) {
        const { data: users } = await supabase
          .from("users")
          .select("id, full_name, email, avatar_url, is_vip, is_admin, is_guardian, last_seen_at, status")
          .in("id", otherUserIds);
        (users || []).forEach((u: any) => { usersMap[u.id] = u; });
      }

// 3. Count unread in parallel
      // Also get the LATEST message timestamp per conversation so we can
      // detect and repair stale last_read_at values
      const unreadCounts: Record<string, number> = {};
      await Promise.all(
        convIds.map(async (cid) => {
          if (activeConvRef.current === cid) {
            unreadCounts[cid] = 0;
            return;
          }
          const lastRead = myPartMap[cid]?.last_read_at;
          if (!lastRead) {
            unreadCounts[cid] = 0;
            return;
          }

          // Get unread count AND the latest message I sent in this chat
          const [unreadResult, myLatestResult] = await Promise.all([
            supabase
              .from("messages")
              .select("*", { count: "exact", head: true })
              .eq("conversation_id", cid)
              .neq("sender_id", user.id)
              .gt("created_at", lastRead)
              .eq("is_deleted", false),
            supabase
              .from("messages")
              .select("created_at")
              .eq("conversation_id", cid)
              .eq("sender_id", user.id)
              .order("created_at", { ascending: false })
              .limit(1),
          ]);

          const rawCount = unreadResult.count || 0;

          // REPAIR: If I sent a message AFTER last_read_at, it means I was
          // in this chat more recently than last_read_at suggests.
          // The last_read_at update must have failed. Fix it now.
          const myLastMsg = myLatestResult.data?.[0]?.created_at;
          if (myLastMsg && new Date(myLastMsg) > new Date(lastRead)) {
            // I was active in this chat after last_read_at — repair it
            const repairedTime = new Date(
              Math.max(new Date(myLastMsg).getTime(), Date.now()) 
            ).toISOString();

            supabase
              .from("conversation_participants")
              .update({ last_read_at: repairedTime })
              .eq("conversation_id", cid)
              .eq("user_id", user.id)
              .then(() => {});

            // After repair, only count messages AFTER my last sent message
            const { count: repairedCount } = await supabase
              .from("messages")
              .select("*", { count: "exact", head: true })
              .eq("conversation_id", cid)
              .neq("sender_id", user.id)
              .gt("created_at", myLastMsg)
              .eq("is_deleted", false);

            unreadCounts[cid] = repairedCount || 0;
          } else {
            unreadCounts[cid] = rawCount;
          }
        })
      );

      // 4. Build final list
      const merged: ConversationWithUser[] = (convRes.data || [])
        .map((conv: any) => {
          const otherId = otherUserMap[conv.id];
          const otherUser = otherId ? usersMap[otherId] : null;
          if (!otherUser) return null;

          let lastMessageSeen = false;
          if (conv.last_message_sender_id === user.id && conv.last_message_at) {
            const otherRead = otherReadMap[conv.id];
            if (otherRead && new Date(otherRead) >= new Date(conv.last_message_at)) {
              lastMessageSeen = true;
            }
          }

          return {
            ...conv,
            other_user: otherUser,
            unread_count: unreadCounts[conv.id] || 0,
            last_message_seen: lastMessageSeen,
          };
        })
        .filter(Boolean) as ConversationWithUser[];

      const sorted = sortByLastMessage(merged);
      setConversations(sorted);
      idbSave(sorted);
      hasFetchedRef.current = true;
    } catch (e: any) {
    } finally {
      setConversationsLoading(false);
    }
  }, [user?.id]);

  // =====================================================
  // INITIAL FETCH — once per mount
  // =====================================================
  useEffect(() => {
    if (!user?.id || !user.is_vip) return;
    hasFetchedRef.current = false;
    fetchConversations();
  }, [user?.id, user?.is_vip, fetchConversations]);

  // =====================================================
  // UNIFIED REALTIME CHANNEL
  //
  // Rules:
  // - Badge increment: ONLY here, ONLY for messages from other users
  //   in conversations we're NOT currently viewing
  // - Badge decrement: ONLY via setActiveConversation or clearUnread
  // - NO fetchConversations after realtime events
  // =====================================================
  useEffect(() => {
    if (!user?.id || !user.is_vip) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`dm-rt-${user.id}-${Date.now()}`)

      // ---- NEW MESSAGE ----
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as any;
          if (!msg.conversation_id) return;

          const userId = userIdRef.current;
          if (!userId) return;

          // Only process messages for conversations we're part of
          const isOurs = conversationsRef.current.some((c) => c.id === msg.conversation_id);
          const isFromMe = msg.sender_id === userId;
          if (!isOurs && !isFromMe) return;

          // Dispatch to chat page listener
          dispatch(msg.conversation_id, (l) => l.onMessageInsert(msg));

          // Update conversation list
          const isViewing = activeConvRef.current === msg.conversation_id;

          setConversations((prev) => {
            let found = false;
            const updated = prev.map((c) => {
              if (c.id !== msg.conversation_id) return c;
              found = true;

              // Dedup check
              if (c.last_message_at && new Date(c.last_message_at).getTime() >= new Date(msg.created_at).getTime()) {
                return c;
              }

              // THE ONLY PLACE unread_count increments:
              // - Message is from someone else
              // - We are NOT viewing that chat right now
              let newUnread = c.unread_count || 0;
              if (!isFromMe && !isViewing) {
                newUnread = newUnread + 1;
              }

              return {
                ...c,
                last_message_text: msg.content?.slice(0, 100) || (msg.content_type === "media" ? "Sent an attachment" : "New message"),
                last_message_at: msg.created_at,
                last_message_sender_id: msg.sender_id,
                last_message_seen: false,
                updated_at: msg.created_at,
                unread_count: newUnread,
              };
            });

            if (!found) return prev;

            const sorted = sortByLastMessage(updated);
            idbSave(sorted);
            return sorted;
          });

          // Auto-mark as read if viewing
          if (isViewing && !isFromMe) {
            supabase
              .from("conversation_participants")
              .update({ last_read_at: new Date().toISOString() })
              .eq("conversation_id", msg.conversation_id)
              .eq("user_id", userId)
              .then(() => {});

            supabase
              .from("message_reads")
              .upsert(
                { message_id: msg.id, user_id: userId, read_at: new Date().toISOString() },
                { onConflict: "message_id,user_id" }
              )
              .then(() => {});
          }

          // Pre-cache in localStorage
          try {
            const key = `peja-chat-cache-${msg.conversation_id}`;
            let msgs: any[] = [];
            const raw = localStorage.getItem(key);
            if (raw) { try { msgs = JSON.parse(raw); } catch {} }
            if (Array.isArray(msgs) && !msgs.find((m: any) => m.id === msg.id)) {
              msgs.push({
                ...msg,
                media: [],
                delivery_status: isFromMe ? "sent" : undefined,
                read_at: null,
                hidden_for_me: false,
                reactions: [],
                reply_to: null,
              });
              localStorage.setItem(key, JSON.stringify(msgs.slice(-100)));
            }
          } catch {}
        }
      )

      // ---- MESSAGE UPDATE (edit/delete) ----
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as any;
          if (!msg.conversation_id) return;
          dispatch(msg.conversation_id, (l) => l.onMessageUpdate(msg));
        }
      )

      // ---- CONVERSATION UPDATE ----
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        (payload) => {
          const updated = payload.new as any;
          setConversations((prev) => {
            const newList = prev.map((c) => {
              if (c.id !== updated.id) return c;
              return {
                ...c,
                last_message_text: updated.last_message_text ?? c.last_message_text,
                last_message_at: updated.last_message_at ?? c.last_message_at,
                last_message_sender_id: updated.last_message_sender_id ?? c.last_message_sender_id,
                updated_at: updated.updated_at ?? c.updated_at,
                // DO NOT touch unread_count here
              };
            });
            const sorted = sortByLastMessage(newList);
            idbSave(sorted);
            return sorted;
          });
        }
      )

      // ---- PARTICIPANT UPDATE ----
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_participants" },
        (payload) => {
          const updated = payload.new as any;
          const userId = userIdRef.current;

          // Other user read our messages — update "seen" status
          if (updated.user_id !== userId && updated.last_read_at) {
            setConversations((prev) =>
              prev.map((c) => {
                if (c.id !== updated.conversation_id) return c;
                if (c.last_message_sender_id !== userId) return c;
                if (!c.last_message_at) return c;
                const seen = new Date(updated.last_read_at) >= new Date(c.last_message_at);
                if (c.last_message_seen === seen) return c;
                return { ...c, last_message_seen: seen };
              })
            );

            dispatch(updated.conversation_id, (l) => l.onParticipantUpdate(updated));
          }
        }
      )

      // ---- READ RECEIPTS ----
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reads" },
        (payload) => {
          const read = payload.new as any;
          if (read.user_id === userIdRef.current) return;

          setConversations((prev) =>
            prev.map((c) => {
              if (c.last_message_sender_id !== userIdRef.current) return c;
              if (c.last_message_seen) return c;
              return { ...c, last_message_seen: true };
            })
          );

          chatListenersRef.current.forEach((listeners) => {
            listeners.forEach((l) => {
              try {
                l.onReadReceipt({
                  message_id: read.message_id,
                  user_id: read.user_id,
                  read_at: read.read_at,
                });
              } catch {}
            });
          });
        }
      )

      // ---- REACTIONS ----
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        async (payload) => {
          const data = (payload.new || payload.old) as any;
          if (!data?.message_id) return;
          const { data: reactions } = await supabase
            .from("message_reactions")
            .select("*")
            .eq("message_id", data.message_id);
          chatListenersRef.current.forEach((listeners) => {
            listeners.forEach((l) => {
              try { l.onReactionChange(data.message_id, reactions || []); } catch {}
            });
          });
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
  }, [user?.id, user?.is_vip, dispatch]);

  // =====================================================
  // BADGE OPERATIONS — the ONLY way to modify unread
  // =====================================================
  const clearUnread = useCallback((conversationId: string) => {
    setConversations((prev) => {
      const conv = prev.find((c) => c.id === conversationId);
      if (!conv || conv.unread_count === 0) return prev;
      const updated = prev.map((c) =>
        c.id === conversationId ? { ...c, unread_count: 0 } : c
      );
      idbSave(updated);
      return updated;
    });
  }, []);

const markConversationRead = useCallback(async (conversationId: string) => {
    if (!user?.id) return;
    clearUnread(conversationId);
    try {
      // Get the latest message timestamp and set last_read_at AFTER it
      const { data } = await supabase
        .from("messages")
        .select("created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1);

      const readTime = data && data.length > 0
        ? new Date(new Date(data[0].created_at).getTime() + 1000).toISOString()
        : new Date().toISOString();

      await supabase
        .from("conversation_participants")
        .update({ last_read_at: readTime })
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id);
    } catch (e) {
    }
  }, [user?.id, clearUnread]);

  const updateLastMessage = useCallback((conversationId: string, text: string, senderId: string) => {
    setConversations((prev) => {
      const now = new Date().toISOString();
      const updated = prev.map((c) =>
        c.id === conversationId
          ? { ...c, last_message_text: text, last_message_at: now, last_message_sender_id: senderId, last_message_seen: false, updated_at: now }
          : c
      );
      const sorted = sortByLastMessage(updated);
      idbSave(sorted);
      return sorted;
    });
  }, []);

  // =====================================================
  // CONTEXT VALUE
  // =====================================================
  const value = useMemo<MessageCacheContextValue>(() => ({
    conversations,
    conversationsLoading,
    fetchConversations,
    setConversations,
    clearUnread,
    markConversationRead,
    updateLastMessage,
    subscribeToChat,
    setActiveConversation,
    activeConversationId,
    recordingConversationId,
    setRecordingConversationId,
  }), [
    conversations,
    conversationsLoading,
    fetchConversations,
    clearUnread,
    markConversationRead,
    updateLastMessage,
    subscribeToChat,
    setActiveConversation,
    activeConversationId,
    recordingConversationId,
  ]);

  return (
    <MessageCacheContext.Provider value={value}>
      {children}
    </MessageCacheContext.Provider>
  );
}

export function useMessageCache() {
  const ctx = useContext(MessageCacheContext);
  if (!ctx) throw new Error("useMessageCache must be used within MessageCacheProvider");
  return ctx;
}
