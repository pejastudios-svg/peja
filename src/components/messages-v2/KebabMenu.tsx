"use client";

// Header kebab dropdown for the v2 chat thread. Mirrors the action
// set in ChatInfoSheet so users get the same options whether they
// tap the name (open info sheet) or the three-dot menu.
//
// Implementation note: this renders as a button + an absolutely
// positioned panel anchored to the trigger. A click anywhere outside
// the panel closes it.

import { useEffect, useRef, useState } from "react";
import {
  MoreVertical,
  BellOff,
  Bell,
  Ban,
  Eraser,
  Trash2,
  Info,
  Flag,
  Search,
  AtSign,
  LogOut,
} from "lucide-react";

interface Props {
  isMuted: boolean;
  isBlocked: boolean;
  onOpenInfo: () => void;
  onSearch: () => void;
  onToggleMute: () => void;
  onToggleBlock: () => void;
  onClearChat: () => void;
  onDeleteChat: () => void;
  onReport: () => void;

  // Group-aware extras. When isGroup is true the menu drops the
  // user-specific actions (Block, Report user) and surfaces group
  // controls instead.
  isGroup?: boolean;
  myRole?: "owner" | "member";
  notificationMode?: "all" | "mentions" | "muted";
  onSetNotificationMode?: (mode: "all" | "mentions" | "muted") => void;
  onLeaveGroup?: () => void;
}

export function KebabMenu({
  isMuted,
  isBlocked,
  onOpenInfo,
  onSearch,
  onToggleMute,
  onToggleBlock,
  onClearChat,
  onDeleteChat,
  onReport,
  isGroup,
  myRole,
  notificationMode,
  onSetNotificationMode,
  onLeaveGroup,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-xl active:bg-white/10 transition-colors"
        aria-label="Chat menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical
          className="w-5 h-5"
          style={{ color: "var(--color-dark-300)" }}
          strokeWidth={2.3}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-[var(--glass-card-bg)] border border-[var(--glass-border-sm)] shadow-lg z-50 overflow-hidden peja-fade-in-scale"
          style={{ transformOrigin: "top right" }}
        >
          <MenuItem
            icon={<Info className="w-4 h-4" />}
            label="View profile"
            onClick={() => {
              close();
              onOpenInfo();
            }}
          />
          <MenuItem
            icon={<Search className="w-4 h-4" />}
            label="Search"
            onClick={() => {
              close();
              onSearch();
            }}
          />
          {/* Groups: mute appearance is driven by notification_mode
              ('muted') so picking Only-mentions doesn't make this
              row look as if you'd fully muted the chat. DMs keep
              the legacy is_muted boolean since they don't have the
              3-way mode. */}
          {(() => {
            const appearMuted = isGroup
              ? notificationMode === "muted"
              : isMuted;
            return (
              <MenuItem
                icon={
                  appearMuted ? (
                    <Bell className="w-4 h-4" />
                  ) : (
                    <BellOff className="w-4 h-4" />
                  )
                }
                label={appearMuted ? "Unmute" : "Mute"}
                onClick={() => {
                  close();
                  onToggleMute();
                }}
              />
            );
          })()}
          {isGroup && onSetNotificationMode && (
            <MenuItem
              icon={<AtSign className="w-4 h-4" />}
              label={
                notificationMode === "mentions"
                  ? "Only mentions: on"
                  : "Only notify on mentions"
              }
              onClick={() => {
                close();
                onSetNotificationMode(
                  notificationMode === "mentions" ? "all" : "mentions"
                );
              }}
            />
          )}
          {!isGroup && (
            <MenuItem
              icon={<Ban className="w-4 h-4" />}
              label={isBlocked ? "Unblock" : "Block"}
              danger
              onClick={() => {
                close();
                onToggleBlock();
              }}
            />
          )}
          <MenuItem
            icon={<Eraser className="w-4 h-4" />}
            label="Clear chat"
            onClick={() => {
              close();
              onClearChat();
            }}
          />
          {!isGroup && (
            <MenuItem
              icon={<Flag className="w-4 h-4" />}
              label="Report"
              danger
              onClick={() => {
                close();
                onReport();
              }}
            />
          )}
          {isGroup && myRole !== "owner" && onLeaveGroup && (
            <MenuItem
              icon={<LogOut className="w-4 h-4" />}
              label="Leave group"
              danger
              onClick={() => {
                close();
                onLeaveGroup();
              }}
            />
          )}
          <MenuItem
            icon={<Trash2 className="w-4 h-4" />}
            label={
              isGroup && myRole === "owner" ? "Delete group" : "Delete chat"
            }
            danger
            onClick={() => {
              close();
              onDeleteChat();
            }}
          />
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function MenuItem({ icon, label, onClick, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-[var(--chat-input-hover)] active:bg-[var(--chat-input-hover)] transition-colors ${
        danger ? "text-red-400" : "text-dark-100"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
