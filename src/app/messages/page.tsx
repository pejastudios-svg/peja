"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { presenceManager } from "@/lib/presence";
import { useMessageCache } from "@/context/MessageCacheContext";
import { BottomNav } from "@/components/layout/BottomNav";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  ArrowLeft,
  Search,
  MessageCircle,
  Plus,
  User,
  Crown,
  Loader2,
  Mic,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Conversation, VIPUser } from "@/lib/types";

type ConversationWithUser = Conversation & {
  other_user: VIPUser;
  unread_count: number;
  last_message_seen?: boolean;
};

export default function MessagesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const {
    conversations,
    conversationsLoading,
    setConversations,
    fetchConversations,
    recordingConversationId,
    clearUnread,
    markConversationRead,
  } = useMessageCache();

  // Use context loading state
  const loading = conversationsLoading;

  const [search, setSearch] = useState("");
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  // New conversation modal
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [vipSearch, setVipSearch] = useState("");
  const [vipResults, setVipResults] = useState<VIPUser[]>([]);
  const [vipSearchLoading, setVipSearchLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [allVips, setAllVips] = useState<VIPUser[]>([]);
  const [allVipsLoading, setAllVipsLoading] = useState(false);

  // =====================================================
  // AUTH GUARD
  // =====================================================
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    if (user.is_vip === false) { router.replace("/"); return; }
  }, [user, authLoading, router]);

   // =====================================================
  // PRESENCE: Online status with debug logging
  // =====================================================
  useEffect(() => {
    const buildOnlineSet = () => {
      // Start with previously known online users from window global
      const prevGlobal = (window as any).__pejaOnlineUsers;
      const online = prevGlobal instanceof Set ? new Set<string>(prevGlobal) : new Set<string>();
      conversations.forEach((c) => {
        if (!c.other_user?.id) return;
        
        const presenceOnline = presenceManager.isOnline(c.other_user.id);
        const lastSeen = c.other_user.last_seen_at;
        const lastSeenDiff = lastSeen ? Date.now() - new Date(lastSeen).getTime() : null;
        const lastSeenOnline = lastSeenDiff !== null && lastSeenDiff < 2 * 60 * 1000;
        
        console.log(`[Online] ${c.other_user.full_name}: presence=${presenceOnline}, lastSeen=${lastSeen}, diff=${lastSeenDiff ? Math.round(lastSeenDiff/1000) + 's' : 'null'}, online=${presenceOnline || lastSeenOnline}`);
        
        if (presenceOnline || lastSeenOnline) {
          online.add(c.other_user.id);
        }
      });
      return online;
    };

    const initialSet = buildOnlineSet();
    console.log("[Online] Initial online users:", initialSet.size, [...initialSet]);
    setOnlineUsers(initialSet);

    const unsub = presenceManager.onStatusChange((userId, isOnline) => {
      console.log("[Online] Presence change:", userId, isOnline);
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        if (isOnline) next.add(userId);
        else next.delete(userId);
        return next;
      });
    });

    const otherIds = conversations.map((c) => c.other_user?.id).filter(Boolean) as string[];

    const pollLastSeen = async () => {
      if (otherIds.length === 0) return;
      
      const { data } = await supabase
        .from("users")
        .select("id, last_seen_at, full_name")
        .in("id", otherIds);

      if (data) {
        console.log("[Online] Poll results:", data.map((u: any) => ({
          name: u.full_name,
          lastSeen: u.last_seen_at,
          diffSec: u.last_seen_at ? Math.round((Date.now() - new Date(u.last_seen_at).getTime()) / 1000) : null,
        })));

        setOnlineUsers((prev) => {
          const next = new Set(prev);
          data.forEach((u: any) => {
            if (presenceManager.isOnline(u.id)) {
              next.add(u.id);
              return;
            }
            if (u.last_seen_at) {
              const diff = Date.now() - new Date(u.last_seen_at).getTime();
              if (diff < 2 * 60 * 1000) {
                next.add(u.id);
              } else {
                next.delete(u.id);
              }
            }
          });
          console.log("[Online] Updated set:", next.size, [...next]);
          return next;
        });
      }
    };

    const initialTimer = setTimeout(pollLastSeen, 1000);
    const pollInterval = setInterval(pollLastSeen, 15000); // Poll every 15s for testing

    return () => {
      unsub();
      clearTimeout(initialTimer);
      clearInterval(pollInterval);
    };
  }, [conversations]);

    // Persist online users to window global for cross-page access
  useEffect(() => {
    (window as any).__pejaOnlineUsers = onlineUsers;
  }, [onlineUsers]);


  useEffect(() => {
    if (user?.id && user.is_vip) {
      // Re-apply clearUnread for the chat we just left
      // This ensures the badge stays cleared even if fetchConversations returns stale data
      try {
        const lastChatId = sessionStorage.getItem("peja-last-chat-id");
        if (lastChatId) {
          clearUnread(lastChatId);
        }
      } catch {}

      fetchConversations();
    }
  }, [user?.id, fetchConversations, clearUnread]);

  // Refresh on focus - clear unreads FIRST, then fetch
  useEffect(() => {
    const handleFocus = () => {
      // STEP 1: Re-apply clears IMMEDIATELY before any fetch.
      // This ensures the badge is visually 0 even if fetchConversations
      // returns stale data from the DB.
      try {
        const lastChatId = sessionStorage.getItem("peja-last-chat-id");
        if (lastChatId) {
          clearUnread(lastChatId);
        }
      } catch {}

      const activeConvo = (window as any).__pejaActiveConversationId;
      if (activeConvo) {
        clearUnread(activeConvo);
      }

      // STEP 2: Fetch fresh data after a short delay.
      // clearUnread added the ID to pendingClearRef, so fetchConversations
      // will respect it and return 0 for that conversation.
      setTimeout(() => {
        fetchConversations();
      }, 500);
    };

    window.addEventListener("focus", handleFocus);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchConversations, clearUnread]);

  // =====================================================
  // SEARCH VIPs
  // =====================================================
  const handleVipSearch = (query: string) => {
    setVipSearch(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (query.trim().length < 2) { setVipResults([]); return; }

    searchTimerRef.current = setTimeout(async () => {
      setVipSearchLoading(true);
      try {
        const q = query.trim().toLowerCase();
        const { data, error } = await supabase
          .from("users")
          .select("id, full_name, email, avatar_url, is_vip, is_admin, is_guardian, last_seen_at, status")
          .eq("is_vip", true)
          .eq("status", "active")
          .neq("id", user?.id || "")
          .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
          .order("full_name", { ascending: true })
          .limit(20);

        if (error) throw error;

        const { data: blocks } = await supabase
          .from("dm_blocks")
          .select("blocked_id, blocker_id")
          .or(`blocker_id.eq.${user?.id},blocked_id.eq.${user?.id}`);

        const blockedIds = new Set<string>();
        (blocks || []).forEach((b: any) => {
          if (b.blocker_id === user?.id) blockedIds.add(b.blocked_id);
          if (b.blocked_id === user?.id) blockedIds.add(b.blocker_id);
        });

        setVipResults((data || []).filter((u: any) => !blockedIds.has(u.id)) as VIPUser[]);
      } catch {
        setVipResults([]);
      } finally {
        setVipSearchLoading(false);
      }
    }, 300);
  };

  // Load all VIPs when modal opens
useEffect(() => {
  if (!newChatOpen || !user?.id) return;

  const loadAllVips = async () => {
    setAllVipsLoading(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email, avatar_url, is_vip, is_admin, is_guardian, last_seen_at, status")
        .eq("is_vip", true)
        .eq("status", "active")
        .neq("id", user.id)
        .order("full_name", { ascending: true })
        .limit(100);

      if (error) throw error;

      const { data: blocks } = await supabase
        .from("dm_blocks")
        .select("blocked_id, blocker_id")
        .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`);

      const blockedIds = new Set<string>();
      (blocks || []).forEach((b: any) => {
        if (b.blocker_id === user.id) blockedIds.add(b.blocked_id);
        if (b.blocked_id === user.id) blockedIds.add(b.blocker_id);
      });

      setAllVips((data || []).filter((u: any) => !blockedIds.has(u.id)) as VIPUser[]);
    } catch {
      setAllVips([]);
    } finally {
      setAllVipsLoading(false);
    }
  };

  loadAllVips();
}, [newChatOpen, user?.id]);

  // =====================================================
  // CREATE OR OPEN CONVERSATION
  // =====================================================
  const startConversation = async (otherUserId: string) => {
    if (!user?.id) return;
    setCreating(otherUserId);
    try {
      const { data: convId, error } = await supabase.rpc("create_dm_conversation", {
        other_user_id: otherUserId,
      });
      if (error) throw error;
      if (!convId) throw new Error("No conversation ID returned");
      setNewChatOpen(false);
      router.push(`/messages/${convId}`, { scroll: false });
    } catch (e: any) {
      console.error("startConversation error:", e?.message || e);
    } finally {
      setCreating(null);
    }
  };

  // =====================================================
  // FILTERED CONVERSATIONS
  // =====================================================
  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = c.other_user?.full_name?.toLowerCase() || "";
      const email = c.other_user?.email?.toLowerCase() || "";
      return name.includes(q) || email.includes(q);
    });
  }, [conversations, search]);

  // =====================================================
  // LOADING / AUTH STATES
  // =====================================================
  if (authLoading || !user) return null;
  if (user.is_vip === false) return null;

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 glass-header">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
            <button
            onClick={() => router.push("/", { scroll: false })}
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="font-semibold text-dark-50 flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary-400" />
            Messages
          </h1>
          <button
            onClick={() => { setNewChatOpen(true); setVipSearch(""); setVipResults([]); }}
            className="p-2 -mr-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <Plus className="w-5 h-5 text-primary-400" />
          </button>
        </div>
      </header>

      <main className="pt-14">
        {conversations.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="w-full h-10 pl-10 pr-4 glass-input text-sm rounded-xl"
              />
            </div>
          </div>
        )}

        <div className="px-4 py-2">
          {loading && conversations.length === 0 ? (
            <div className="space-y-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <ConversationSkeleton key={i} />
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-20 h-20 rounded-full bg-primary-600/10 flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="w-10 h-10 text-primary-400" />
              </div>
              <h2 className="text-lg font-semibold text-dark-100 mb-2">
                {search ? "No conversations found" : "No messages yet"}
              </h2>
              <p className="text-sm text-dark-400 mb-6 max-w-xs mx-auto">
                {search ? "Try a different search" : "Start a conversation with another VIP member"}
              </p>
              {!search && (
                <Button variant="primary" onClick={() => { setNewChatOpen(true); setVipSearch(""); setVipResults([]); }}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Message
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredConversations.map((conv) => {
                const isUserOnline = onlineUsers.has(conv.other_user.id);
                const isMySend = conv.last_message_sender_id === user.id;

                return (
                  <button
                    key={conv.id}
                                       onClick={() => {
  // Clear unread INSTANTLY via context
  if (conv.unread_count > 0) {
    clearUnread(conv.id);
  }
  
  // Mark as read in database (background)
  markConversationRead(conv.id);
  
  // Navigate
  router.push(`/messages/${conv.id}`, { scroll: false });
}}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-white/5 transition-colors active:scale-[0.98] duration-150 text-left"
                  >
                    {/* Avatar with online indicator */}
                    <div className="relative shrink-0">
                      <div
                        className="rounded-full overflow-hidden bg-dark-800 border border-white/10 flex items-center justify-center"
                        style={{ width: 52, height: 52 }}
                      >
                        {conv.other_user.avatar_url ? (
                          <img src={conv.other_user.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-6 h-6 text-dark-400" />
                        )}
                      </div>
                      {/* Purple online dot */}
                      {isUserOnline && (
                        <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-purple-500 border-2 border-[#1e1033] online-dot-pulse" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-semibold text-dark-100 truncate">
                            {conv.other_user.full_name || "Unknown"}
                          </span>
                          {conv.other_user.is_admin && (
                            <Crown className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                          )}
                        </div>
                        {conv.last_message_at && (
                          <span className="text-[11px] text-dark-500 shrink-0">
                            {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: false })}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-0.5">
  {recordingConversationId === conv.id ? (
    <div className="flex items-center gap-1.5 flex-1">
      <Mic className="w-3.5 h-3.5 text-red-400 animate-pulse" />
      <span className="text-xs text-red-400 font-medium">Recording voice note...</span>
    </div>
  ) : (
    <p className="text-xs text-dark-400 truncate flex-1">
      {isMySend && (
        <span className="text-dark-500 mr-1">You:</span>
      )}
      {conv.last_message_text || "No messages yet"}
    </p>
  )}

  <div className="flex items-center gap-1.5 shrink-0">
  {/* Sent/Seen indicator for own messages */}
  {isMySend && recordingConversationId !== conv.id && (
    <span
      className={`text-[10px] font-medium ${
        conv.last_message_seen
          ? "text-purple-400 drop-shadow-[0_0_4px_rgba(168,85,247,0.6)]"
          : "text-dark-500"
      }`}
    >
      {conv.last_message_seen ? "Seen" : "Sent"}
    </span>
  )}

                          {/* Unread badge */}
                          {conv.unread_count > 0 && (
                            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary-600 text-white text-[11px] font-bold flex items-center justify-center">
                              {conv.unread_count > 99 ? "99+" : conv.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* =====================================================
          NEW CONVERSATION MODAL
          ===================================================== */}
      <Modal isOpen={newChatOpen} onClose={() => setNewChatOpen(false)} title="New Message" size="lg">
        <div className="space-y-4">
          <p className="text-sm text-dark-400">Search for a VIP member to start a conversation.</p>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input
              value={vipSearch}
              onChange={(e) => handleVipSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full h-11 pl-10 pr-4 bg-[#1E1B24] border border-white/10 rounded-xl text-sm focus:outline-none focus:border-primary-500/50 transition-all"
              autoFocus
            />
          </div>

          <div className="max-h-[400px] overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-white/10">
            {vipSearchLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
                <span className="ml-2 text-sm text-dark-400">Searching...</span>
              </div>
            ) : vipSearch.trim().length < 2 ? (
  <>
    <PejaAdminEntry userId={user.id} onSelect={startConversation} creating={creating} />
    {allVipsLoading ? (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
        <span className="ml-2 text-sm text-dark-400">Loading VIP members...</span>
      </div>
    ) : allVips.length > 0 ? (
      allVips.map((v) => {
        const vOnline = onlineUsers.has(v.id);
        return (
          <button
            key={v.id}
            onClick={() => startConversation(v.id)}
            disabled={creating !== null}
            className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors disabled:opacity-50 text-left"
          >
            <div className="relative shrink-0">
              <div className="w-11 h-11 rounded-full overflow-hidden bg-dark-800 border border-white/10 flex items-center justify-center">
                {v.avatar_url ? (
                  <img src={v.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-5 h-5 text-dark-400" />
                )}
              </div>
              {vOnline && (
                <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-purple-500 border-2 border-[#1e1033] online-dot-pulse" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-dark-100 truncate">{v.full_name || "Unknown"}</span>
                {v.is_admin && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
              </div>
              <p className="text-xs text-dark-500 truncate">{v.email}</p>
            </div>
            {creating === v.id ? (
              <Loader2 className="w-4 h-4 text-primary-400 animate-spin shrink-0" />
            ) : (
              <MessageCircle className="w-4 h-4 text-dark-500 shrink-0" />
            )}
          </button>
        );
      })
    ) : null}
  </>
            ) : vipResults.length === 0 ? (
              <div className="text-center py-8">
                <User className="w-8 h-8 text-dark-600 mx-auto mb-2" />
                <p className="text-sm text-dark-500">No VIP members found</p>
              </div>
            ) : (
              vipResults.map((v) => {
                const vOnline = onlineUsers.has(v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => startConversation(v.id)}
                    disabled={creating !== null}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors disabled:opacity-50 text-left"
                  >
                    <div className="relative shrink-0">
                      <div className="w-11 h-11 rounded-full overflow-hidden bg-dark-800 border border-white/10 flex items-center justify-center">
                        {v.avatar_url ? (
                          <img src={v.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-5 h-5 text-dark-400" />
                        )}
                      </div>
                      {vOnline && (
                        <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-purple-500 border-2 border-[#1e1033] online-dot-pulse" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-dark-100 truncate">{v.full_name || "Unknown"}</span>
                        {v.is_admin && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
                      </div>
                      <p className="text-xs text-dark-500 truncate">{v.email}</p>
                    </div>
                    {creating === v.id ? (
                      <Loader2 className="w-4 h-4 text-primary-400 animate-spin shrink-0" />
                    ) : (
                      <MessageCircle className="w-4 h-4 text-dark-500 shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      <BottomNav />
    </div>
  );
}

// =====================================================
// PEJA ADMIN ENTRY
// =====================================================
function PejaAdminEntry({ userId, onSelect, creating }: { userId: string; onSelect: (id: string) => void; creating: string | null }) {
  const [adminUser, setAdminUser] = useState<VIPUser | null>(null);

  useEffect(() => {
    supabase
      .from("users")
      .select("id, full_name, email, avatar_url, is_vip, is_admin, is_guardian, last_seen_at, status")
      .eq("email", "pejastudios@gmail.com")
      .single()
      .then(({ data }) => {
        if (data && data.id !== userId) setAdminUser(data as VIPUser);
      });
  }, [userId]);

  if (!adminUser) return null;

  const isOnline = presenceManager.isOnline(adminUser.id);

  return (
    <div className="mb-3">
      <p className="text-[11px] text-dark-500 uppercase tracking-wider font-bold px-1 mb-2">Peja Support</p>
      <button
        onClick={() => onSelect(adminUser.id)}
        disabled={creating !== null}
        className="w-full flex items-center gap-3 p-3 rounded-xl bg-primary-600/10 border border-primary-500/20 hover:bg-primary-600/15 transition-colors disabled:opacity-50 text-left"
      >
        <div className="relative shrink-0">
          <div className="w-11 h-11 rounded-full overflow-hidden bg-primary-600/20 border-2 border-primary-500/40 flex items-center justify-center">
            {adminUser.avatar_url ? (
              <img src={adminUser.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <Crown className="w-5 h-5 text-primary-400" />
            )}
          </div>
          {isOnline && (
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-purple-500 border-2 border-[#1e1033] online-dot-pulse" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-primary-300">Peja</span>
            <Crown className="w-3.5 h-3.5 text-yellow-400" />
          </div>
          <p className="text-xs text-dark-400">Message the Peja team directly</p>
        </div>
        {creating === adminUser.id ? (
          <Loader2 className="w-4 h-4 text-primary-400 animate-spin shrink-0" />
        ) : (
          <MessageCircle className="w-4 h-4 text-primary-400 shrink-0" />
        )}
      </button>
      <div className="border-b border-white/5 mt-3" />
      <p className="text-[11px] text-dark-500 uppercase tracking-wider font-bold px-1 mt-3 mb-2">VIP Members</p>
    </div>
  );
}

// =====================================================
// SKELETON
// =====================================================
function ConversationSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="w-[52px] h-[52px] rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="h-3 w-48 mt-2" />
      </div>
    </div>
  );
}