"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
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
  Check,
  CheckCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Conversation, VIPUser } from "@/lib/types";

type ConversationWithUser = Conversation & {
  other_user: VIPUser;
  unread_count: number;
};

export default function MessagesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const channelRef = useRef<any>(null);

  const [conversations, setConversations] = useState<ConversationWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // New conversation modal
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [vipSearch, setVipSearch] = useState("");
  const [vipResults, setVipResults] = useState<VIPUser[]>([]);
  const [vipSearchLoading, setVipSearchLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const CONV_CACHE_KEY = "peja-conversations-cache";

  // Restore from sessionStorage on mount
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(CONV_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setConversations(parsed);
          setLoading(false);
        }
      }
    } catch {}
  }, []);

  // =====================================================
  // AUTH GUARD
  // =====================================================
  useEffect(() => {
    console.log("[Messages] Auth state:", {
      authLoading,
      userId: user?.id,
      isVip: user?.is_vip,
      userKeys: user ? Object.keys(user) : "null",
    });

    if (authLoading) return;
    if (!user) {
      console.log("[Messages] No user, redirecting to login");
      router.replace("/login");
      return;
    }
    if (user.is_vip === false) {
      console.log("[Messages] User is NOT VIP, redirecting to /");
      router.replace("/");
      return;
    }
    console.log("[Messages] Auth OK, user is VIP");
  }, [user, authLoading, router]);

  // =====================================================
  // FETCH CONVERSATIONS
  // =====================================================
    const fetchConversations = async () => {
    if (!user?.id) return;
    if (conversations.length === 0) setLoading(true);

    try {
      // Get all conversation IDs this user is part of
      const { data: participantRows, error: pErr } = await supabase
        .from("conversation_participants")
        .select("conversation_id, last_read_at, is_blocked, is_muted")
        .eq("user_id", user.id);

      if (pErr) {
        console.error("participant fetch error:", pErr.message, pErr.details, pErr.hint);
        throw pErr;
      }

      if (!participantRows || participantRows.length === 0) {
        setConversations([]);
        setLoading(false);
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

      // Get conversations
      const { data: convData, error: cErr } = await supabase
        .from("conversations")
        .select("*")
        .in("id", convIds)
        .order("updated_at", { ascending: false });

      if (cErr) {
        console.error("conversations fetch error:", cErr.message, cErr.details, cErr.hint);
        throw cErr;
      }

      // Get the OTHER participant for each conversation
      const { data: allParticipants, error: apErr } = await supabase
        .from("conversation_participants")
        .select("conversation_id, user_id")
        .in("conversation_id", convIds)
        .neq("user_id", user.id);

      if (apErr) {
        console.error("other participants fetch error:", apErr.message, apErr.details, apErr.hint);
        throw apErr;
      }

      const otherUserMap: Record<string, string> = {};
      (allParticipants || []).forEach((p) => {
        otherUserMap[p.conversation_id] = p.user_id;
      });

      // Get user profiles for other participants
      const otherUserIds = Array.from(new Set(Object.values(otherUserMap)));

      let usersData: any[] = [];
      if (otherUserIds.length > 0) {
        const { data, error: uErr } = await supabase
          .from("users")
          .select("id, full_name, email, avatar_url, is_vip, is_admin, is_guardian, last_seen_at, status")
          .in("id", otherUserIds);

        if (uErr) {
          console.error("users fetch error:", uErr.message, uErr.details, uErr.hint);
          throw uErr;
        }
        usersData = data || [];
      }

      const usersMap: Record<string, VIPUser> = {};
      usersData.forEach((u: any) => {
        usersMap[u.id] = u;
      });

      // Count unread messages per conversation (batch approach)
      const unreadCounts: Record<string, number> = {};

      for (const convId of convIds) {
        const lastRead = participantMap[convId]?.last_read_at;

        if (!lastRead) {
          unreadCounts[convId] = 0;
          continue;
        }

        try {
          const { count, error: countErr } = await supabase
            .from("messages")
            .select("*", { count: "exact", head: true })
            .eq("conversation_id", convId)
            .neq("sender_id", user.id)
            .gt("created_at", lastRead)
            .eq("is_deleted", false);

          if (countErr) {
            console.warn("unread count error for conv", convId, countErr.message);
            unreadCounts[convId] = 0;
          } else {
            unreadCounts[convId] = count || 0;
          }
        } catch {
          unreadCounts[convId] = 0;
        }
      }

      // Build final list
      const merged: ConversationWithUser[] = (convData || [])
        .map((conv: any) => {
          const otherUserId = otherUserMap[conv.id];
          const otherUser = otherUserId ? usersMap[otherUserId] : null;

          if (!otherUser) return null;

          return {
            ...conv,
            other_user: otherUser,
            unread_count: unreadCounts[conv.id] || 0,
          };
        })
        .filter(Boolean) as ConversationWithUser[];

      setConversations(merged);
      try { sessionStorage.setItem(CONV_CACHE_KEY, JSON.stringify(merged)); } catch {}
    } catch (e: any) {
      console.error("fetchConversations error:", e?.message || e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.id && user.is_vip) {
      fetchConversations();
    }
  }, [user?.id]);

  // =====================================================
  // REALTIME: Listen for new messages
  // =====================================================
  useEffect(() => {
    if (!user?.id) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`messages-list-${user.id}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        () => {
          fetchConversations();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
        },
        () => {
          fetchConversations();
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
  }, [user?.id]);

  // =====================================================
  // SEARCH VIPs (for new conversation)
  // =====================================================
  const handleVipSearch = (query: string) => {
    setVipSearch(query);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (query.trim().length < 2) {
      setVipResults([]);
      return;
    }

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

        // Filter out blocked users
        const { data: blocks } = await supabase
          .from("dm_blocks")
          .select("blocked_id, blocker_id")
          .or(`blocker_id.eq.${user?.id},blocked_id.eq.${user?.id}`);

        const blockedIds = new Set<string>();
        (blocks || []).forEach((b: any) => {
          if (b.blocker_id === user?.id) blockedIds.add(b.blocked_id);
          if (b.blocked_id === user?.id) blockedIds.add(b.blocker_id);
        });

        const filtered = (data || []).filter((u: any) => !blockedIds.has(u.id));
        setVipResults(filtered as VIPUser[]);
      } catch (e) {
        console.error("VIP search error:", e);
        setVipResults([]);
      } finally {
        setVipSearchLoading(false);
      }
    }, 300);
  };

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

      if (error) {
        console.error("create_dm_conversation error:", error.message, error.details, error.hint);
        throw error;
      }

      if (!convId) {
        throw new Error("No conversation ID returned");
      }

      setNewChatOpen(false);
      router.push(`/messages/${convId}`);
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
  // ONLINE STATUS HELPER
  // =====================================================
  const isOnline = (lastSeen: string | null | undefined): boolean => {
    if (!lastSeen) return false;
    const diff = Date.now() - new Date(lastSeen).getTime();
    return diff < 2 * 60 * 1000; // 2 minutes
  };

  // =====================================================
  // LOADING / AUTH STATES
  // =====================================================
  if (authLoading) {
    return (
      <div className="min-h-screen pb-20">
        <div className="fixed top-0 left-0 right-0 z-40 glass-header h-14" />
        <div className="pt-16 px-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </div>
        <BottomNav />
      </div>
    );
  }

     if (authLoading || !user) return null;
     if (user.is_vip === false) return null;

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 glass-header">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
            <button
            onClick={() => router.push("/")}
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="font-semibold text-dark-50 flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary-400" />
            Messages
          </h1>
          <button
            onClick={() => {
              setNewChatOpen(true);
              setVipSearch("");
              setVipResults([]);
            }}
            className="p-2 -mr-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <Plus className="w-5 h-5 text-primary-400" />
          </button>
        </div>
      </header>

      <main className="pt-14">
        {/* Search conversations */}
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

        {/* Conversations list */}
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
                {search
                  ? "Try a different search"
                  : "Start a conversation with another VIP member"}
              </p>
              {!search && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setNewChatOpen(true);
                    setVipSearch("");
                    setVipResults([]);
                  }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Message
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => router.push(`/messages/${conv.id}`)}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-white/5 transition-colors active:scale-[0.98] duration-150 text-left"
                >
                  {/* Avatar with online indicator */}
                  <div className="relative shrink-0">
                    <div className="w-13 h-13 rounded-full overflow-hidden bg-dark-800 border border-white/10 flex items-center justify-center"
                         style={{ width: 52, height: 52 }}>
                      {conv.other_user.avatar_url ? (
                        <img
                          src={conv.other_user.avatar_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-6 h-6 text-dark-400" />
                      )}
                    </div>
                    {/* Online dot */}
                    {isOnline(conv.other_user.last_seen_at) && (
                      <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-[#1e1033]" />
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
                          {formatDistanceToNow(new Date(conv.last_message_at), {
                            addSuffix: false,
                          })}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-dark-400 truncate flex-1">
                        {conv.last_message_sender_id === user.id && (
                          <span className="text-dark-500 mr-1">You:</span>
                        )}
                        {conv.last_message_text || "No messages yet"}
                      </p>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Read receipt indicator for own messages */}
                        {conv.last_message_sender_id === user.id && (
                          <CheckCheck className="w-3.5 h-3.5 text-primary-400" />
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
              ))}
            </div>
          )}
        </div>
      </main>

      {/* =====================================================
          NEW CONVERSATION MODAL
          ===================================================== */}
      <Modal
        isOpen={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        title="New Message"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-dark-400">
            Search for a VIP member to start a conversation.
          </p>

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
              <PejaAdminEntry
                userId={user.id}
                onSelect={startConversation}
                creating={creating}
              />
            ) : vipResults.length === 0 ? (
              <div className="text-center py-8">
                <User className="w-8 h-8 text-dark-600 mx-auto mb-2" />
                <p className="text-sm text-dark-500">No VIP members found</p>
              </div>
            ) : (
              vipResults.map((v) => (
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
                    {isOnline(v.last_seen_at) && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-[#1e1033]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-dark-100 truncate">
                        {v.full_name || "Unknown"}
                      </span>
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
              ))
            )}
          </div>
        </div>
      </Modal>

      <BottomNav />
    </div>
  );
}

// =====================================================
// PEJA ADMIN ENTRY (always shown at top of new chat)
// =====================================================
function PejaAdminEntry({
  userId,
  onSelect,
  creating,
}: {
  userId: string;
  onSelect: (id: string) => void;
  creating: string | null;
}) {
  const [adminUser, setAdminUser] = useState<VIPUser | null>(null);

  useEffect(() => {
    const fetchAdmin = async () => {
      const { data } = await supabase
        .from("users")
        .select("id, full_name, email, avatar_url, is_vip, is_admin, is_guardian, last_seen_at, status")
        .eq("email", "pejastudios@gmail.com")
        .single();

      if (data && data.id !== userId) {
        setAdminUser(data as VIPUser);
      }
    };

    fetchAdmin();
  }, [userId]);

  if (!adminUser) return null;

  const isOnline = adminUser.last_seen_at
    ? Date.now() - new Date(adminUser.last_seen_at).getTime() < 2 * 60 * 1000
    : false;

  return (
    <div className="mb-3">
      <p className="text-[11px] text-dark-500 uppercase tracking-wider font-bold px-1 mb-2">
        Peja Support
      </p>
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
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-[#1e1033]" />
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
      <p className="text-[11px] text-dark-500 uppercase tracking-wider font-bold px-1 mt-3 mb-2">
        VIP Members
      </p>
      <p className="text-xs text-dark-500 px-1">Type at least 2 characters to search</p>
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