"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthContext";
import type { Message, Conversation, VIPUser } from "@/lib/types";

type ConversationWithUser = Conversation & {
  other_user: VIPUser;
  unread_count: number;
  last_message_seen?: boolean;
};

type CachedConversation = {
  conversation: ConversationWithUser;
  messages: Message[];
  lastFetch: number;
};

interface MessageCacheContextValue {
  // Conversations list
  conversations: ConversationWithUser[];
  conversationsLoading: boolean;
  setConversations: React.Dispatch<React.SetStateAction<ConversationWithUser[]>>;
  fetchConversations: (force?: boolean) => Promise<void>;
  
  // Individual conversation
  getConversation: (id: string) => CachedConversation | null;
  getCachedMessages: (conversationId: string) => Message[];
  cacheMessages: (conversationId: string, messages: Message[]) => void;
  
  // Optimistic updates - INSTANT
  clearUnread: (conversationId: string) => void;
  markConversationRead: (conversationId: string) => void;
  addOptimisticMessage: (conversationId: string, message: Message) => void;
  updateMessageStatus: (conversationId: string, tempId: string, realMessage: Message) => void;
  updateLastMessage: (conversationId: string, text: string, senderId: string) => void;
  
  // Recording state
  recordingConversationId: string | null;
  setRecordingConversationId: (id: string | null) => void;
  
  // Typing state (for header display)
  typingInConversation: string | null;
  setTypingInConversation: (id: string | null) => void;
}

const MessageCacheContext = createContext<MessageCacheContextValue | null>(null);

// IndexedDB helper for persistent cache
const DB_NAME = "peja-messages";
const DB_VERSION = 1;
const CONV_STORE = "conversations";

async function openDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => resolve(null);
      
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(CONV_STORE)) {
          db.createObjectStore(CONV_STORE, { keyPath: "id" });
        }
      };
    } catch {
      resolve(null);
    }
  });
}

async function saveToIDB(conversations: ConversationWithUser[]): Promise<void> {
  const db = await openDB();
  if (!db) return;
  
  try {
    const tx = db.transaction(CONV_STORE, "readwrite");
    const store = tx.objectStore(CONV_STORE);
    
    // Clear and save fresh
    store.clear();
    conversations.forEach((c) => store.put(c));
    
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject();
    });
  } catch {} finally {
    db.close();
  }
}

async function loadFromIDB(): Promise<ConversationWithUser[]> {
  const db = await openDB();
  if (!db) return [];
  
  try {
    const tx = db.transaction(CONV_STORE, "readonly");
    const store = tx.objectStore(CONV_STORE);
    
    return new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function MessageCacheProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  
  const [conversations, setConversations] = useState<ConversationWithUser[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationCache, setConversationCache] = useState<Map<string, CachedConversation>>(new Map());
  const [recordingConversationId, setRecordingConversationId] = useState<string | null>(null);
  const [typingInConversation, setTypingInConversation] = useState<string | null>(null);
  
  const channelRef = useRef<any>(null);
  const lastFetchRef = useRef<number>(0);
  const fetchInProgressRef = useRef<boolean>(false);
  const pendingClearRef = useRef<Set<string>>(new Set());
  const pendingClearTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const initialFetchDoneRef = useRef(false);

  // =====================================================
  // LOAD FROM INDEXEDDB ON MOUNT (instant restore)
  // =====================================================
  useEffect(() => {
    if (!user?.id) return;
    
    const loadCached = async () => {
      const cached = await loadFromIDB();
      if (cached.length > 0) {
        // Apply any pending clears to cached data (in case IDB save was stale)
        const withClears = pendingClearRef.current.size > 0
          ? cached.map((c) =>
              pendingClearRef.current.has(c.id) ? { ...c, unread_count: 0 } : c
            )
          : cached;
        setConversations(withClears);
        setConversationsLoading(false);
      }
    };
    
    loadCached();
  }, [user?.id]);

  // =====================================================
  // HELPER: Check if a conversation is currently being viewed
  // This is the SINGLE SOURCE OF TRUTH for "is user looking at this chat"
  // =====================================================
  const isConversationActive = useCallback((conversationId: string): boolean => {
    if (typeof window === "undefined") return false;
    // Check the global flag set by chat page on mount/unmount
    if ((window as any).__pejaActiveConversationId === conversationId) return true;
    // Fallback: check URL
    if (window.location.pathname.includes(conversationId)) return true;
    return false;
  }, []);

  // =====================================================
  // FETCH CONVERSATIONS (with smart debouncing)
  // =====================================================
  const fetchConversations = useCallback(async (force = false) => {
    if (!user?.id) return;
    
    // Prevent concurrent fetches
    if (fetchInProgressRef.current && !force) return;
    
    // Debounce rapid calls (2 second minimum between fetches)
    const now = Date.now();
    if (!force && now - lastFetchRef.current < 2000) return;
    
    fetchInProgressRef.current = true;
    lastFetchRef.current = now;

    try {
      const { data: participantRows, error: pErr } = await supabase
        .from("conversation_participants")
        .select("conversation_id, last_read_at, is_blocked, is_muted")
        .eq("user_id", user.id);

      if (pErr) throw pErr;
      if (!participantRows || participantRows.length === 0) {
        setConversations([]);
        setConversationsLoading(false);
        fetchInProgressRef.current = false;
        return;
      }

      const convIds = participantRows.map((p) => p.conversation_id);
      const participantMap: Record<string, { last_read_at: string; is_blocked: boolean; is_muted: boolean }> = {};
      participantRows.forEach((p) => {
        participantMap[p.conversation_id] = {
          last_read_at: p.last_read_at,
          is_blocked: p.is_blocked,
          is_muted: p.is_muted,
        };
      });

      const { data: convData, error: cErr } = await supabase
        .from("conversations")
        .select("*")
        .in("id", convIds)
        .order("updated_at", { ascending: false });

      if (cErr) throw cErr;

      const { data: allParticipants, error: apErr } = await supabase
        .from("conversation_participants")
        .select("conversation_id, user_id, last_read_at")
        .in("conversation_id", convIds)
        .neq("user_id", user.id);

      if (apErr) throw apErr;

      const otherUserMap: Record<string, string> = {};
      const otherLastReadMap: Record<string, string> = {};
      (allParticipants || []).forEach((p) => {
        otherUserMap[p.conversation_id] = p.user_id;
        otherLastReadMap[p.conversation_id] = p.last_read_at;
      });

      const otherUserIds = Array.from(new Set(Object.values(otherUserMap)));

      let usersData: any[] = [];
      if (otherUserIds.length > 0) {
        const { data, error: uErr } = await supabase
          .from("users")
          .select("id, full_name, email, avatar_url, is_vip, is_admin, is_guardian, last_seen_at, status")
          .in("id", otherUserIds);
        if (uErr) throw uErr;
        usersData = data || [];
      }

      const usersMap: Record<string, VIPUser> = {};
      usersData.forEach((u: any) => { usersMap[u.id] = u; });

      // Batch count unread - use Promise.all for speed
      const unreadResults = await Promise.all(
        convIds.map(async (convId) => {
          // If this conversation is currently being viewed OR has a pending clear, return 0
          if (pendingClearRef.current.has(convId) || isConversationActive(convId)) {
            return { convId, count: 0 };
          }
          
          const lastRead = participantMap[convId]?.last_read_at;
          if (!lastRead) return { convId, count: 0 };

          const { count } = await supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("conversation_id", convId)
            .neq("sender_id", user.id)
            .gt("created_at", lastRead)
            .eq("is_deleted", false);

          return { convId, count: count || 0 };
        })
      );

      const unreadCounts: Record<string, number> = {};
      unreadResults.forEach((r) => { unreadCounts[r.convId] = r.count; });

      const merged: ConversationWithUser[] = (convData || [])
        .map((conv: any) => {
          const otherUserId = otherUserMap[conv.id];
          const otherUser = otherUserId ? usersMap[otherUserId] : null;
          if (!otherUser) return null;

          let lastMessageSeen = false;
          if (conv.last_message_sender_id === user.id && conv.last_message_at) {
            const otherLastRead = otherLastReadMap[conv.id];
            if (otherLastRead && new Date(otherLastRead) >= new Date(conv.last_message_at)) {
              lastMessageSeen = true;
            }
          }

          // Respect pending clears AND active conversation
          const unreadCount = (pendingClearRef.current.has(conv.id) || isConversationActive(conv.id))
            ? 0 
            : (unreadCounts[conv.id] || 0);

          return {
            ...conv,
            other_user: otherUser,
            unread_count: unreadCount,
            last_message_seen: lastMessageSeen,
          };
        })
        .filter(Boolean) as ConversationWithUser[];

      // FINAL SAFETY NET: Apply pendingClearRef one more time before setting state.
      // This catches any edge case where the DB returned stale data.
      const finalMerged = pendingClearRef.current.size > 0
        ? merged.map((c) =>
            (pendingClearRef.current.has(c.id) || isConversationActive(c.id))
              ? { ...c, unread_count: 0 }
              : c
          )
        : merged;

      setConversations(finalMerged);
      initialFetchDoneRef.current = true;
      
      // Save to IndexedDB for instant restore
      saveToIDB(finalMerged);
      
    } catch (e: any) {
      console.error("fetchConversations error:", e?.message || e);
    } finally {
      setConversationsLoading(false);
      fetchInProgressRef.current = false;
    }
  }, [user?.id, isConversationActive]);

  // =====================================================
  // INITIAL FETCH + REALTIME
  // =====================================================
  useEffect(() => {
    if (!user?.id || !user.is_vip) return;

    initialFetchDoneRef.current = false;
    fetchConversations();

    // Realtime updates - debounced
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    let fetchTimeout: NodeJS.Timeout | null = null;
    const debouncedFetch = () => {
      if (fetchTimeout) clearTimeout(fetchTimeout);
      fetchTimeout = setTimeout(() => fetchConversations(true), 500);
    };

    const channel = supabase
      .channel(`dm-cache-${user.id}-${Date.now()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as any;

        // Suppress until initial fetch completes to prevent pop-in
        if (!initialFetchDoneRef.current) return;

        setConversations((prev) => {
          // USE THE AUTHORITATIVE CHECK: is user currently viewing this chat?
          const isActive = isConversationActive(msg.conversation_id);
          // Also check pendingClearRef (user recently viewed and left)
          const isCleared = pendingClearRef.current.has(msg.conversation_id);

          const updated = prev.map((c) => {
            if (c.id !== msg.conversation_id) return c;

            // Dedup: skip if we already processed this message timestamp
            if (
              c.last_message_at &&
              new Date(c.last_message_at).getTime() >= new Date(msg.created_at).getTime()
            ) {
              // Even if deduped, enforce unread=0 if active or cleared
              if ((isActive || isCleared) && c.unread_count > 0) {
                return { ...c, unread_count: 0 };
              }
              return c;
            }

            const isFromOther = msg.sender_id !== user.id;

            // DETERMINE UNREAD COUNT:
            // - If user is actively viewing this chat → 0
            // - If conversation was recently cleared (pendingClearRef) → 0
            // - If message is from the other user and NOT viewing → increment
            // - If message is from me → keep current
            let newUnreadCount = c.unread_count;
            if (isActive || isCleared) {
              newUnreadCount = 0;
            } else if (isFromOther) {
              newUnreadCount = (c.unread_count || 0) + 1;
            }

            return {
              ...c,
              last_message_text:
                msg.content?.slice(0, 100) ||
                (msg.content_type === "media" ? "Sent an attachment" : "New message"),
              last_message_at: msg.created_at,
              last_message_sender_id: msg.sender_id,
              last_message_seen: false,
              updated_at: msg.created_at,
              unread_count: newUnreadCount,
            };
          });

          updated.sort((a, b) => {
            const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return bTime - aTime;
          });

          saveToIDB(updated);
          return updated;
        });

        debouncedFetch();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, (payload) => {
        const updated = payload.new as any;

        if (!initialFetchDoneRef.current) return;

        setConversations((prev) => {
          const newList = prev.map((c) => {
            if (c.id !== updated.id) return c;

            // Preserve unread count — don't let conversation updates reset it
            // Also enforce cleared/active state
            const shouldBeZero = pendingClearRef.current.has(c.id) || isConversationActive(c.id);

            return {
              ...c,
              last_message_text: updated.last_message_text ?? c.last_message_text,
              last_message_at: updated.last_message_at ?? c.last_message_at,
              last_message_sender_id: updated.last_message_sender_id ?? c.last_message_sender_id,
              updated_at: updated.updated_at ?? c.updated_at,
              unread_count: shouldBeZero ? 0 : c.unread_count,
            };
          });

          newList.sort((a, b) => {
            const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return bTime - aTime;
          });

          saveToIDB(newList);
          return newList;
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_participants" }, (payload) => {
        const updated = payload.new as any;
        if (updated.user_id !== user.id && updated.last_read_at) {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== updated.conversation_id) return c;
              if (c.last_message_sender_id !== user.id) return c;
              if (!c.last_message_at) return c;
              const seen = new Date(updated.last_read_at) >= new Date(c.last_message_at);
              return { ...c, last_message_seen: seen };
            })
          );
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reads" }, (payload) => {
        const read = payload.new as any;
        if (read.user_id !== user.id) {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.last_message_sender_id !== user.id) return c;
              return { ...c, last_message_seen: true };
            })
          );
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (fetchTimeout) clearTimeout(fetchTimeout);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [user?.id, user?.is_vip, fetchConversations, isConversationActive]);

  // =====================================================
  // CACHE HELPERS
  // =====================================================
  const getConversation = useCallback((id: string) => {
    return conversationCache.get(id) || null;
  }, [conversationCache]);

  const getCachedMessages = useCallback((conversationId: string) => {
    return conversationCache.get(conversationId)?.messages || [];
  }, [conversationCache]);

  const cacheMessages = useCallback((conversationId: string, messages: Message[]) => {
    setConversationCache((prev) => {
      const next = new Map(prev);
      const conv = conversations.find((c) => c.id === conversationId);
      if (!conv) return next;
      
      next.set(conversationId, {
        conversation: conv,
        messages,
        lastFetch: Date.now(),
      });
      return next;
    });
  }, [conversations]);

  // =====================================================
  // INSTANT OPTIMISTIC UPDATES
  // =====================================================
  const clearUnread = useCallback((conversationId: string) => {
    pendingClearRef.current.add(conversationId);
    
    // Auto-expire after 15 seconds (DB should have updated by then)
    const existing = pendingClearTimersRef.current.get(conversationId);
    if (existing) clearTimeout(existing);
    pendingClearTimersRef.current.set(
      conversationId,
      setTimeout(() => {
        pendingClearRef.current.delete(conversationId);
        pendingClearTimersRef.current.delete(conversationId);
      }, 15000)
    );
    
    // Update state immediately
    setConversations((prev) => {
      const updated = prev.map((c) => 
        c.id === conversationId ? { ...c, unread_count: 0 } : c
      );
      saveToIDB(updated);
      return updated;
    });
  }, []);

  const markConversationRead = useCallback(async (conversationId: string) => {
    if (!user?.id) return;
    
    // Optimistic update first
    clearUnread(conversationId);
    
    // Background DB update
    try {
      await supabase
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id);
    } catch (e) {
      console.error("Failed to mark as read:", e);
    }
  }, [user?.id, clearUnread]);

  const updateLastMessage = useCallback((conversationId: string, text: string, senderId: string) => {
    setConversations((prev) => {
      const now = new Date().toISOString();
      const updated = prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              last_message_text: text,
              last_message_at: now,
              last_message_sender_id: senderId,
              last_message_seen: false,
              updated_at: now,
            }
          : c
      );

      // Sort by most recent
      updated.sort((a, b) => {
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bTime - aTime;
      });

      saveToIDB(updated);
      return updated;
    });
  }, []);

  const addOptimisticMessage = useCallback((conversationId: string, message: Message) => {
    setConversationCache((prev) => {
      const next = new Map(prev);
      const cached = next.get(conversationId);
      if (!cached) return next;
      
      next.set(conversationId, {
        ...cached,
        messages: [...cached.messages, message],
      });
      return next;
    });
  }, []);

  const updateMessageStatus = useCallback((conversationId: string, tempId: string, realMessage: Message) => {
    setConversationCache((prev) => {
      const next = new Map(prev);
      const cached = next.get(conversationId);
      if (!cached) return next;
      
      next.set(conversationId, {
        ...cached,
        messages: cached.messages.map((m) => (m.id === tempId ? realMessage : m)),
      });
      return next;
    });
  }, []);

  const value: MessageCacheContextValue = {
    conversations,
    conversationsLoading,
    setConversations,
    fetchConversations,
    getConversation,
    getCachedMessages,
    cacheMessages,
    clearUnread,
    markConversationRead,
    addOptimisticMessage,
    updateMessageStatus,
    updateLastMessage,
    recordingConversationId,
    setRecordingConversationId,
    typingInConversation,
    setTypingInConversation,
  };

  return <MessageCacheContext.Provider value={value}>{children}</MessageCacheContext.Provider>;
}

export function useMessageCache() {
  const ctx = useContext(MessageCacheContext);
  if (!ctx) throw new Error("useMessageCache must be used within MessageCacheProvider");
  return ctx;
}