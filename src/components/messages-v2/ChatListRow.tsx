"use client";

// Single row in the v2 conversation list. Owns:
//   • the visual layout (avatar / name / preview / unread badge)
//   • a per-row 3-dot kebab dropdown (desktop only — surfaced via
//     group-hover so it's invisible on touch; touch users get the
//     same action set via long-press → multi-select)
//   • long-press detection that enters multi-select mode
//   • a checkbox swap that replaces the unread badge when the page
//     is in multi-select
//
// Extracted from the list page so each row can own its own
// useLongPress hook + kebab open/closed state (you can't call hooks
// inside a `.map`).

import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Check,
  MoreVertical,
  BellOff,
  Bell,
  Ban,
  Eraser,
  Trash2,
  CheckSquare,
  User,
  Users,
  Pin,
  PinOff,
} from "lucide-react";
import type { ChatConversationSummary } from "@/features/chat/types";
import { useLongPress } from "@/features/chat/useLongPress";
import { useChatStore } from "@/features/chat/store";
import { formatChatPreview } from "@/components/messages-v2/IncidentLinkPreview";

export type ChatRowAction =
  | "mute"
  | "block"
  | "clear"
  | "delete"
  | "select"
  | "pin"
  | "leave";

interface Props {
  conv: ChatConversationSummary;
  draft: string | undefined;
  isOnline: boolean;
  isMine: boolean;
  selectMode: boolean;
  isSelected: boolean;
  // Total rows currently selected. Drives the WhatsApp-style "single-
  // selection kebab" — when exactly one row is selected, that row's
  // kebab stays available so per-row actions (pin/mute/clear/block)
  // are reachable without exiting select mode. Multi-select hides the
  // kebab because only bulk actions in SelectActionBar apply then.
  selectedCount: number;
  onTap: () => void;
  onEnterSelectMode: () => void;
  onKebabAction: (action: ChatRowAction) => void;
}

export function ChatListRow({
  conv,
  draft,
  isOnline,
  isMine,
  selectMode,
  isSelected,
  selectedCount,
  onTap,
  onEnterSelectMode,
  onKebabAction,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Typing / recording indicator for THIS conversation only. Populated
  // by the broadcast listener mounted in the list page
  // (useListTypingChannels) — entries auto-expire after 3 s in the
  // store. The listener already drops events sent by the current user,
  // so any present entry means somebody else is typing/recording.
  const typingEntry = useChatStore((s) => s.typingByConversation[conv.id]);
  const typingKind = typingEntry?.kind ?? null;

  // Long-press = enter multi-select. Suppressed while already in
  // select mode (tap toggles selection there instead).
  const longPress = useLongPress({
    onLongPress: () => {
      if (selectMode) return;
      onEnterSelectMode();
    },
  });

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const fireAction = (action: ChatRowAction) => {
    setMenuOpen(false);
    onKebabAction(action);
  };

  return (
    <div
      onClick={onTap}
      {...longPress}
      className={`group relative w-full flex items-center gap-3 py-3 px-1 text-left rounded-xl transition-colors cursor-pointer ${
        isSelected
          ? "bg-primary-500/15"
          : "hover:bg-[var(--chat-input-hover)]"
      }`}
    >
      {/* Avatar / checkbox slot. In select mode the avatar shrinks
          and a checkbox circle overlays its bottom-right corner so
          the user can see both who they're selecting and the toggle
          state. */}
      <div className="relative shrink-0">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-primary-600/20 border border-white/10 flex items-center justify-center">
          {conv.other_user_avatar_url ? (
            <img
              src={conv.other_user_avatar_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : conv.is_group ? (
            <Users className="w-5 h-5 text-primary-300" />
          ) : (
            <User className="w-5 h-5 text-primary-300" />
          )}
        </div>
        {/* Groups don't have presence — only DMs get the online dot. */}
        {isOnline && !selectMode && !conv.is_group && (
          <span
            className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-purple-500 border-2 border-[var(--page-bg)]"
            aria-label="Online"
          />
        )}
        {selectMode && (
          <span
            className={`peja-pop-in absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center border-2 border-[var(--page-bg)] ${
              isSelected ? "bg-primary-600 text-white" : "bg-[var(--chat-input-bg)]"
            }`}
            aria-hidden
          >
            {isSelected && <Check className="w-3 h-3" />}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-dark-100 truncate">
            {conv.other_user_name || "Unknown"}
          </p>
          {/* Status icons: blocked / muted / pinned. Sit alongside
              the timestamp so they're always visible to the right of
              the contact's name. notification_mode is the new source
              of truth for "muted" (the legacy is_muted boolean is
              kept in lock step by the RPC). is_blocked is DM-only. */}
          <span className="text-[11px] text-dark-500 shrink-0 inline-flex items-center gap-1">
            {!conv.is_group && conv.is_blocked && (
              <Ban
                className="w-3 h-3 text-red-400"
                aria-label="Blocked"
              />
            )}
            {(conv.notification_mode === "muted" || conv.is_muted) && (
              <BellOff
                className="w-3 h-3 text-dark-400"
                aria-label="Muted"
              />
            )}
            {conv.is_pinned && (
              <Pin
                className="w-3 h-3 text-primary-400"
                aria-label="Pinned"
              />
            )}
            {conv.last_message_at &&
              formatDistanceToNow(new Date(conv.last_message_at), {
                addSuffix: false,
              })}
          </span>
        </div>
        <p className="text-sm text-dark-400 truncate">
          {typingKind === "typing" ? (
            // Live activity beats the last-message preview and the
            // draft. Colour matches the chat header subtitle so the
            // signal reads as "live" everywhere it appears.
            <span className="text-primary-400">typing…</span>
          ) : typingKind === "recording" ? (
            <span className="text-red-400">recording…</span>
          ) : draft ? (
            <>
              <span className="text-red-400">Draft: </span>
              {draft}
            </>
          ) : (
            <>
              {isMine && conv.last_message_text ? "You: " : ""}
              {/* The DB trigger writes media-type-aware previews
                  ("📷 Photo", "🎥 Video", "🎙 Voice note",
                  "📎 File"). The optimistic sender-side bump now
                  writes the SAME strings, so we no longer coerce
                  "Sent an attachment" → "📷 Photo" (that lied for
                  voice notes and videos). formatChatPreview handles
                  the URL-only incident-share case by replacing the
                  raw peja.life/post link with "📢 Shared an
                  incident"; the fallback string is shown verbatim
                  when the trigger raced ahead. */}
              {formatChatPreview(conv.last_message_text) || "No messages yet"}
            </>
          )}
        </p>
      </div>

      {/* Right slot: unread badge OR desktop hover-kebab. They never
          show at the same time — once you're in the kebab dropdown
          the unread badge sits in the avatar position implicitly via
          the existing unread count rendering. */}
      {!selectMode && conv.unread_count > 0 && (
        <div className="shrink-0 min-w-[20px] h-5 rounded-full bg-primary-600 text-white text-[11px] font-bold flex items-center justify-center px-1.5">
          {conv.unread_count > 99 ? "99+" : conv.unread_count}
        </div>
      )}

      {/* Per-row kebab.
          - Out of select mode: desktop hover reveals; mobile sees it
            only when opened (was the prior behavior).
          - In select mode AND this row is the lone selection: stay
            always-visible so the user can tap it for per-row actions
            (WhatsApp pattern). Selecting more rows hides the kebab
            because only bulk SelectActionBar actions apply then. */}
      {(!selectMode || (isSelected && selectedCount === 1)) && (
        <div
          ref={menuRef}
          className="relative shrink-0 mr-2"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-dark-300 ${
              menuOpen || (selectMode && isSelected && selectedCount === 1)
                ? "bg-[var(--chat-input-hover)] opacity-100"
                : "opacity-0 group-hover:opacity-100"
            } transition-opacity`}
            aria-label="Chat options"
            aria-expanded={menuOpen}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 w-48 rounded-xl bg-[var(--glass-card-bg)] border border-[var(--glass-border-sm)] shadow-lg z-50 overflow-hidden peja-fade-in-scale"
              style={{ transformOrigin: "top right" }}
            >
              <Item
                icon={<CheckSquare className="w-4 h-4" />}
                label="Select"
                onClick={() => {
                  setMenuOpen(false);
                  onEnterSelectMode();
                }}
              />
              <Item
                icon={
                  conv.is_pinned ? (
                    <PinOff className="w-4 h-4" />
                  ) : (
                    <Pin className="w-4 h-4" />
                  )
                }
                label={conv.is_pinned ? "Unpin" : "Pin to top"}
                onClick={() => fireAction("pin")}
              />
              <Item
                icon={
                  conv.is_muted ? (
                    <Bell className="w-4 h-4" />
                  ) : (
                    <BellOff className="w-4 h-4" />
                  )
                }
                label={conv.is_muted ? "Unmute" : "Mute"}
                onClick={() => fireAction("mute")}
              />
              {!conv.is_group && (
                <Item
                  icon={<Ban className="w-4 h-4" />}
                  label={conv.is_blocked ? "Unblock" : "Block"}
                  onClick={() => fireAction("block")}
                  danger
                />
              )}
              <Item
                icon={<Eraser className="w-4 h-4" />}
                label="Clear chat"
                onClick={() => fireAction("clear")}
              />
              {/* Groups: members can leave; the owner uses delete.
                  DMs: per-user delete only. */}
              {conv.is_group && conv.my_role !== "owner" ? (
                <Item
                  icon={<Trash2 className="w-4 h-4" />}
                  label="Leave group"
                  onClick={() => fireAction("leave")}
                  danger
                />
              ) : (
                <Item
                  icon={<Trash2 className="w-4 h-4" />}
                  label={
                    conv.is_group && conv.my_role === "owner"
                      ? "Delete group"
                      : "Delete chat"
                  }
                  onClick={() => fireAction("delete")}
                  danger
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Item({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-[var(--chat-input-hover)] transition-colors ${
        danger ? "text-red-400" : "text-dark-100"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
