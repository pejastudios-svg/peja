"use client";

// v2 conversation list. Reads everything from the chat store; renders are
// driven by realtime updates and on-demand fetches via useChatInit. There
// is no per-page useEffect for fetching messages, no localStorage cache
// restore, no merge logic — those failure modes are gone by design.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { Header } from "@/components/layout/Header";
import { useChatStore } from "@/features/chat/store";
import { useChatInit } from "@/features/chat/useChatInit";
import { User } from "lucide-react";

export default function MessagesV2Page() {
  const router = useRouter();
  const { user } = useAuth();
  useChatInit();

  // Narrow selectors so this component only re-renders when the list
  // order or summaries change — individual thread updates don't ripple
  // through here.
  const conversationOrder = useChatStore((s) => s.conversationOrder);
  const conversationsById = useChatStore((s) => s.conversationsById);
  const hydrated = useChatStore((s) => s.conversationsHydrated);

  const conversations = useMemo(
    () => conversationOrder.map((id) => conversationsById[id]).filter(Boolean),
    [conversationOrder, conversationsById]
  );

  return (
    <div className="min-h-screen pb-20">
      <Header variant="back" title="Messages (v2)" onBack={() => router.push("/")} />

      <main className="pt-app-header-pill max-w-2xl mx-auto px-4">
        {!user && (
          <p className="text-sm text-dark-400 py-12 text-center">
            Sign in to see your messages.
          </p>
        )}

        {user && !hydrated && (
          <div className="space-y-3 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <div className="w-12 h-12 rounded-full bg-white/5 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-white/5 rounded animate-pulse" />
                  <div className="h-3 w-48 bg-white/5 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {user && hydrated && conversations.length === 0 && (
          <p className="text-sm text-dark-400 py-12 text-center">
            You don&apos;t have any conversations yet.
          </p>
        )}

        {user && hydrated && conversations.length > 0 && (
          <div>
            {conversations.map((conv) => {
              const isFromMe = conv.last_message_sender_id === user.id;
              return (
                <button
                  key={conv.id}
                  onClick={() => router.push(`/messages-v2/${conv.id}`)}
                  className="w-full flex items-center gap-3 py-3 px-1 text-left hover:bg-white/5 rounded-xl transition-colors"
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-primary-600/20 border border-white/10 flex items-center justify-center shrink-0">
                    {conv.other_user_avatar_url ? (
                      <img
                        src={conv.other_user_avatar_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-5 h-5 text-primary-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-dark-100 truncate">
                        {conv.other_user_name || "Unknown"}
                      </p>
                      {conv.last_message_at && (
                        <span className="text-[11px] text-dark-500 shrink-0">
                          {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: false })}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-dark-400 truncate">
                      {isFromMe && conv.last_message_text ? "You: " : ""}
                      {conv.last_message_text || "No messages yet"}
                    </p>
                  </div>
                  {conv.unread_count > 0 && (
                    <div className="shrink-0 min-w-[20px] h-5 rounded-full bg-primary-600 text-white text-[11px] font-bold flex items-center justify-center px-1.5">
                      {conv.unread_count > 99 ? "99+" : conv.unread_count}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
