"use client";

// Conversation list. Reads everything from the chat store; renders are
// driven by realtime updates and on-demand fetches via useChatInit,
// which is mounted globally via <ChatBootstrap /> in the root layout.
// There is no per-page useEffect for fetching messages, no localStorage
// cache restore, no merge logic — those failure modes are gone by
// design.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Header } from "@/components/layout/Header";
import { useChatStore } from "@/features/chat/store";
import { useListTypingChannels } from "@/features/chat/useListTypingChannels";
import { useToast } from "@/context/ToastContext";
import {
  setNotificationMode,
  setBlocked,
  clearChatForUser,
  deleteChatForUser,
  setConversationPinned,
  leaveGroup,
  deleteGroup,
} from "@/features/chat/api";
import { notifyDMBlocked } from "@/lib/notifications";
import { deleteCachedThread } from "@/features/chat/threadCache";
import { ChatListRow, type ChatRowAction } from "@/components/messages-v2/ChatListRow";
import { SelectActionBar } from "@/components/messages-v2/SelectActionBar";
import { SearchAllChatsSheet } from "@/components/messages-v2/SearchAllChatsSheet";
import { NewDMSheet } from "@/components/messages-v2/NewDMSheet";
import { GroupCreatorSheet } from "@/components/messages-v2/GroupCreatorSheet";
import { Search, Plus, MessageSquare, Users } from "lucide-react";
import { isPejaUser } from "@/lib/peja";

export default function MessagesV2Page() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  // Narrow selectors so this component only re-renders when the list
  // order or summaries change — individual thread updates don't ripple
  // through here.
  const conversationOrder = useChatStore((s) => s.conversationOrder);
  const conversationsById = useChatStore((s) => s.conversationsById);
  const hydrated = useChatStore((s) => s.conversationsHydrated);
  const draftsByConversation = useChatStore((s) => s.draftsByConversation);
  const onlineUserIds = useChatStore((s) => s.onlineUserIds);

  const conversations = useMemo(
    () => conversationOrder.map((id) => conversationsById[id]).filter(Boolean),
    [conversationOrder, conversationsById]
  );

  // Subscribe to typing / recording broadcasts for every conversation
  // in the list so the row can render "typing…" / "recording…"
  // without the user having to enter the thread first. Channels are
  // opened lazily as the list changes and torn down on unmount.
  useListTypingChannels(conversationOrder, user?.id ?? null);
  // Filter tab — All / Chats (DMs) / Groups. Persisted in
  // sessionStorage so flipping into a thread and back keeps the
  // user's current view. Not stored globally because the choice
  // is intentionally a viewing preference, not a setting.
  type ChatTab = "all" | "chats" | "groups";
  const [activeTab, setActiveTab] = useState<ChatTab>(() => {
    if (typeof window === "undefined") return "all";
    const stored = window.sessionStorage.getItem("peja-chat-tab");
    if (stored === "chats" || stored === "groups" || stored === "all")
      return stored;
    return "all";
  });
  const setTab = (t: ChatTab) => {
    setActiveTab(t);
    try {
      window.sessionStorage.setItem("peja-chat-tab", t);
    } catch {}
  };

  // Tab counts come off the full unfiltered list so the badges
  // reflect totals even when the user is on a single tab.
  const tabCounts = useMemo(() => {
    let chats = 0;
    let groups = 0;
    for (const c of conversations) {
      if (c.is_group) groups++;
      else chats++;
    }
    return { all: chats + groups, chats, groups };
  }, [conversations]);
  const visibleConversations = useMemo(() => {
    if (activeTab === "chats") return conversations.filter((c) => !c.is_group);
    if (activeTab === "groups") return conversations.filter((c) => c.is_group);
    return conversations;
  }, [conversations, activeTab]);

  // === Multi-select state ===
  // Entered via long-press on any row OR via the per-row kebab's
  // "Select" item. Exits when the user taps the cancel X, or once
  // bulk-delete completes. We keep the selected ids in a Set rather
  // than an array so toggle is O(1).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Cross-chat search overlay — opened by the search icon in the
  // header. Slide-in/out animations live inside the sheet itself.
  const [searchOpen, setSearchOpen] = useState(false);
  // New-DM picker. Opened by the floating "+" button. Only shown
  // to elevated users (MVP / VIP / admin) because regular users
  // can't start DMs in the MVP/VIP model.
  const [newDmOpen, setNewDmOpen] = useState(false);
  // Peja-only group creator. Plus a small "speed-dial" menu peja sees
  // when tapping the FAB so they can pick between DM and Group; other
  // elevated users tap the FAB and go straight into the DM picker.
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const canStartDm = !!(user?.is_mvp || user?.is_vip || user?.is_admin);
  const canCreateGroup = isPejaUser(user);

  // Inline confirm modal — same pattern as the thread page. Used by
  // block / clear / delete (per-chat) AND bulk delete.
  const [pendingAction, setPendingAction] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    danger: boolean;
    run: () => Promise<void> | void;
  } | null>(null);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const enterSelectMode = useCallback((firstId: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([firstId]));
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === conversations.length) {
        // toggle: select-all when at full count clears it
        return new Set();
      }
      return new Set(conversations.map((c) => c.id));
    });
  }, [conversations]);

  // ---- Per-chat single-action handlers ----
  // Each one mirrors the equivalent in the thread page (since the
  // schema + helpers are the same). We rebuild them here so the user
  // can run the action from the list without opening the chat.

  const handleSingleAction = useCallback(
    (
      conv: {
        id: string;
        other_user_id: string;
        other_user_name: string | null;
        is_muted: boolean;
        is_blocked: boolean;
        is_pinned?: boolean;
        is_group?: boolean;
        my_role?: "owner" | "member";
        notification_mode?: "all" | "mentions" | "muted";
      },
      action: ChatRowAction
    ) => {
      if (!user?.id) return;

      if (action === "select") {
        enterSelectMode(conv.id);
        return;
      }

      if (action === "pin") {
        const next = !conv.is_pinned;
        const store = useChatStore.getState();
        store.patchConversation(conv.id, {
          is_pinned: next,
          pinned_at: next ? new Date().toISOString() : null,
        });
        setConversationPinned(conv.id, next)
          .then(() => toast.info(next ? "Pinned to top" : "Unpinned"))
          .catch(() => {
            store.patchConversation(conv.id, {
              is_pinned: !next,
              pinned_at: !next ? new Date().toISOString() : null,
            });
            toast.danger("Couldn't update pin. Try again.");
          });
        return;
      }

      if (action === "leave") {
        setPendingAction({
          title: "Leave this group?",
          body: `You'll stop receiving messages from ${conv.other_user_name || "this group"}. The group owner can add you back later.`,
          confirmLabel: "Leave",
          danger: true,
          run: async () => {
            try {
              await leaveGroup(conv.id);
              useChatStore.getState().removeConversation(conv.id);
              toast.info("Left the group");
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Couldn't leave. Try again.";
              toast.danger(msg);
            }
          },
        });
        return;
      }

      if (action === "mute") {
        // The list kebab is a binary "muted" ↔ "all" toggle. The
        // 3-way picker ('mentions') lives in the chat info sheet.
        // We switched from the legacy setMuted (which only wrote
        // is_muted) to setNotificationMode so the server-side mute
        // check in peja_notify_dm actually sees the change —
        // notification_mode defaults to 'all' NOT NULL, so the
        // legacy fallback path never fires and setMuted no longer
        // suppresses notifications by itself.
        const wasMuted =
          conv.notification_mode === "muted" || conv.is_muted === true;
        const nextMode = wasMuted ? "all" : "muted";
        useChatStore.getState().patchConversation(conv.id, {
          notification_mode: nextMode,
          is_muted: nextMode !== "all",
        });
        setNotificationMode(conv.id, nextMode)
          .then(() =>
            toast.info(
              nextMode === "muted" ? "Notifications muted" : "Notifications on"
            )
          )
          .catch(() => {
            useChatStore.getState().patchConversation(conv.id, {
              notification_mode: wasMuted ? "muted" : "all",
              is_muted: wasMuted,
            });
            toast.danger("Couldn't update mute. Try again.");
          });
        return;
      }

      if (action === "block") {
        const next = !conv.is_blocked;
        if (!next) {
          // Unblock — non-destructive, no confirm.
          useChatStore
            .getState()
            .patchConversation(conv.id, { is_blocked: false });
          setBlocked(user.id, conv.other_user_id, conv.id, false)
            .then(() => toast.info("User unblocked"))
            .catch(() => {
              useChatStore
                .getState()
                .patchConversation(conv.id, { is_blocked: true });
              toast.danger("Couldn't unblock. Try again.");
            });
          return;
        }
        setPendingAction({
          title: "Block this user?",
          body: `${conv.other_user_name || "They"} won't be able to message you. You can unblock anytime.`,
          confirmLabel: "Block",
          danger: true,
          run: async () => {
            useChatStore
              .getState()
              .patchConversation(conv.id, { is_blocked: true });
            try {
              await setBlocked(user.id, conv.other_user_id, conv.id, true);
              notifyDMBlocked(
                conv.other_user_id,
                user.full_name || "Someone"
              ).catch(() => {});
              toast.warning("User blocked");
            } catch {
              useChatStore
                .getState()
                .patchConversation(conv.id, { is_blocked: false });
              toast.danger("Couldn't block. Try again.");
            }
          },
        });
        return;
      }

      if (action === "clear") {
        setPendingAction({
          title: "Clear this chat?",
          body: "Every message will disappear from your view. The other person still sees their copy.",
          confirmLabel: "Clear",
          danger: true,
          run: async () => {
            // Optimistic: wipe the list row's preview + thread cache
            // immediately so the user sees the change land without
            // waiting for the DB round trip.
            const store = useChatStore.getState();
            store.patchConversation(conv.id, {
              last_message_text: null,
              last_message_at: null,
              last_message_sender_id: null,
              unread_count: 0,
            });
            // clearThread (not setThread([])) — see comment in the chat
            // detail page's handleClearChat for why the latter no-ops.
            store.clearThread(conv.id);
            // Also drop the IDB snapshot so re-entering the chat doesn't
            // warm-start with the cleared messages.
            void deleteCachedThread(user.id, conv.id);
            try {
              await clearChatForUser(conv.id, user.id);
              toast.info("Chat cleared");
            } catch {
              toast.danger("Couldn't clear. Try again.");
            }
          },
        });
        return;
      }

      if (action === "delete") {
        // Group owner → server-side delete of the whole conversation
        // for everyone. DM or non-owner group fall-through (which
        // shouldn't happen, since the row kebab routes non-owners
        // to "leave") → per-user soft delete only.
        const isOwnerOfGroup = !!conv.is_group && conv.my_role === "owner";
        setPendingAction({
          title: isOwnerOfGroup ? "Delete this group?" : "Delete this chat?",
          body: isOwnerOfGroup
            ? "The group and every message in it will be removed for everyone. This can't be undone."
            : "It'll disappear from your list. If they message you again, it'll come back.",
          confirmLabel: "Delete",
          danger: true,
          run: async () => {
            try {
              if (isOwnerOfGroup) {
                await deleteGroup(conv.id);
              } else {
                await deleteChatForUser(conv.id, user.id);
              }
            } catch {
              toast.danger("Couldn't delete. Try again.");
              return;
            }
            useChatStore.getState().removeConversation(conv.id);
            toast.info(isOwnerOfGroup ? "Group deleted" : "Chat deleted");
          },
        });
        return;
      }
    },
    [user?.id, user?.full_name, toast, enterSelectMode]
  );

  // ---- Bulk delete ----
  const handleBulkDelete = useCallback(() => {
    if (!user?.id) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setPendingAction({
      title: `Delete ${ids.length} chat${ids.length > 1 ? "s" : ""}?`,
      body: "They'll disappear from your list. If they message you again, they'll come back.",
      confirmLabel: "Delete",
      danger: true,
      run: async () => {
        // Run all deletes in parallel — `deleteChatForUser` only
        // touches the current user's rows, so there's no cross-row
        // contention. Optimistically remove each from the store as
        // its DB call resolves; if one fails we let the next
        // fetchConversationList reconcile (rare and recoverable).
        const store = useChatStore.getState();
        let failed = 0;
        await Promise.all(
          ids.map(async (id) => {
            try {
              await deleteChatForUser(id, user.id);
              store.removeConversation(id);
            } catch {
              failed += 1;
            }
          })
        );
        if (failed > 0) {
          toast.danger(
            `Couldn't delete ${failed} of ${ids.length}. Try again.`
          );
        } else {
          toast.info(
            ids.length === 1
              ? "Chat deleted"
              : `${ids.length} chats deleted`
          );
        }
        exitSelectMode();
      },
    });
  }, [user?.id, selectedIds, toast, exitSelectMode]);

  return (
    <div className="min-h-screen pb-app-bottom-nav lg:pb-0">
      {selectMode ? (
        <SelectActionBar
          selectedCount={selectedIds.size}
          totalCount={conversations.length}
          onCancel={exitSelectMode}
          onSelectAll={selectAll}
          onBulkDelete={handleBulkDelete}
        />
      ) : (
        <Header
          variant="back"
          title="Messages"
          onBack={() => router.push("/")}
          actions={
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="relative p-2 rounded-xl active:bg-white/10 transition-colors"
              aria-label="Search messages"
            >
              <Search
                className="w-5 h-5"
                style={{ color: "var(--color-dark-300)" }}
                strokeWidth={2.3}
              />
            </button>
          }
        />
      )}

      <main className="pt-app-header-pill max-w-2xl mx-auto px-4">
        {!user && (
          <p className="text-sm text-dark-400 py-12 text-center">
            Sign in to see your messages.
          </p>
        )}

        {user && hydrated && conversations.length > 0 && !selectMode && (
          <nav
            className="sticky top-0 z-20 -mx-4 px-4 pt-1 pb-2 bg-[var(--page-bg)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--page-bg)]/70 flex items-center gap-1"
            aria-label="Conversation filter"
          >
            {(
              [
                { key: "all" as const, label: "All", count: tabCounts.all },
                { key: "chats" as const, label: "Chats", count: tabCounts.chats },
                { key: "groups" as const, label: "Groups", count: tabCounts.groups },
              ]
            ).map((t) => {
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`px-3 h-8 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    active
                      ? "bg-primary-600 text-white"
                      : "bg-[var(--chat-input-bg)] text-dark-300 hover:bg-[var(--chat-input-hover)]"
                  }`}
                  aria-pressed={active}
                >
                  <span>{t.label}</span>
                  {t.count > 0 && (
                    <span
                      className={`text-[10px] tabular-nums px-1 rounded-full ${
                        active
                          ? "bg-white/20 text-white"
                          : "bg-[var(--page-bg)] text-dark-400"
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        {user && !hydrated && (
          <div className="space-y-3 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <div className="w-12 h-12 rounded-full bg-[var(--chat-input-bg)] animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-[var(--chat-input-bg)] rounded animate-pulse" />
                  <div className="h-3 w-48 bg-[var(--chat-input-bg)] rounded animate-pulse" />
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

        {user && hydrated && conversations.length > 0 && visibleConversations.length === 0 && (
          <p className="text-sm text-dark-400 py-12 text-center">
            {activeTab === "groups"
              ? "No groups yet."
              : activeTab === "chats"
                ? "No direct chats yet."
                : "Nothing here yet."}
          </p>
        )}

        {user && hydrated && visibleConversations.length > 0 && (
          <div>
            {visibleConversations.map((conv) => {
              const isFromMe = conv.last_message_sender_id === user.id;
              const draft = draftsByConversation[conv.id]?.trim();
              const otherOnline = Boolean(
                conv.other_user_id && onlineUserIds[conv.other_user_id]
              );
              return (
                <ChatListRow
                  key={conv.id}
                  conv={conv}
                  draft={draft}
                  isOnline={otherOnline}
                  isMine={isFromMe}
                  selectMode={selectMode}
                  isSelected={selectedIds.has(conv.id)}
                  selectedCount={selectedIds.size}
                  onTap={() => {
                    if (selectMode) {
                      toggleSelect(conv.id);
                      return;
                    }
                    router.push(`/messages/${conv.id}`);
                  }}
                  onEnterSelectMode={() => enterSelectMode(conv.id)}
                  onKebabAction={(action) => {
                    // Picking a per-row action from the kebab while in
                    // single-select means the user committed to that
                    // one chat — drop select mode so they're not stuck
                    // tapping X afterward.
                    if (selectMode) exitSelectMode();
                    handleSingleAction(conv, action);
                  }}
                />
              );
            })}
          </div>
        )}
      </main>

      {searchOpen && user && (
        <SearchAllChatsSheet
          currentUserId={user.id}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {newDmOpen && user && (
        <NewDMSheet
          currentUserId={user.id}
          onClose={() => setNewDmOpen(false)}
        />
      )}

      {/* Floating "+" — shown to users who can actually start new
          conversations. Stays mounted in select mode so we get a
          spring bounce-in/out (cubic-bezier overshoot) instead of a
          hard pop. Peja gets a small speed-dial menu when tapping
          (DM / Group); everyone else jumps straight into the DM
          picker. */}
      {canStartDm && (
        <>
          {/* Backdrop — only mounted when the speed-dial menu is up
              so taps anywhere outside dismiss it. */}
          {fabMenuOpen && (
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setFabMenuOpen(false)}
              className="fixed inset-0 z-30 bg-transparent"
            />
          )}

          {/* Speed-dial actions. Each slides up + fades in above the
              FAB when peja opens the menu. Disabled (transform-only)
              when canCreateGroup is false so the speed-dial is
              effectively skipped for non-peja elevated users. */}
          {canCreateGroup && (
            <>
              <button
                type="button"
                onClick={() => {
                  setFabMenuOpen(false);
                  setGroupCreatorOpen(true);
                }}
                style={{
                  bottom: "calc(env(safe-area-inset-bottom, 0px) + 162px)",
                  transition:
                    "transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 180ms ease",
                }}
                className={`fixed right-5 z-40 h-11 px-4 rounded-full bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] text-dark-100 text-sm font-medium shadow-lg flex items-center gap-2 active:scale-95 ${
                  fabMenuOpen && !selectMode
                    ? "scale-100 opacity-100"
                    : "scale-0 opacity-0 pointer-events-none"
                }`}
                aria-label="Create group"
              >
                <Users className="w-4 h-4 text-primary-300" />
                <span>New group</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setFabMenuOpen(false);
                  setNewDmOpen(true);
                }}
                style={{
                  bottom: "calc(env(safe-area-inset-bottom, 0px) + 110px)",
                  transition:
                    "transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1) 40ms, opacity 180ms ease 40ms",
                }}
                className={`fixed right-5 z-40 h-11 px-4 rounded-full bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] text-dark-100 text-sm font-medium shadow-lg flex items-center gap-2 active:scale-95 ${
                  fabMenuOpen && !selectMode
                    ? "scale-100 opacity-100"
                    : "scale-0 opacity-0 pointer-events-none"
                }`}
                aria-label="Start a new chat"
              >
                <MessageSquare className="w-4 h-4 text-primary-300" />
                <span>New chat</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              if (canCreateGroup) {
                setFabMenuOpen((v) => !v);
              } else {
                setNewDmOpen(true);
              }
            }}
            className={`fixed right-5 z-40 w-14 h-14 rounded-full bg-primary-600 text-white flex items-center justify-center shadow-xl active:scale-95 ${
              selectMode
                ? "scale-0 opacity-0 pointer-events-none"
                : "scale-100 opacity-100"
            }`}
            style={{
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
              transition:
                "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease",
            }}
            aria-label={canCreateGroup ? "New chat or group" : "Start a new chat"}
          >
            <Plus
              className={`w-6 h-6 transition-transform duration-200 ${
                fabMenuOpen ? "rotate-45" : ""
              }`}
            />
          </button>
        </>
      )}

      {groupCreatorOpen && user && (
        <GroupCreatorSheet
          currentUserId={user.id}
          onClose={() => setGroupCreatorOpen(false)}
        />
      )}

      {pendingAction && (
        <div
          onClick={() => setPendingAction(null)}
          className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[var(--glass-card-bg)] border border-[var(--glass-border-sm)] shadow-2xl p-5 peja-fade-in-scale"
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
