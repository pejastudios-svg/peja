"use client";

// Context menu for a single message bubble. Opened by:
//   • mobile: long-press on the bubble (500 ms hold)
//   • desktop: hover-then-click on a small chevron that appears at
//     the bubble's top-right, OR right-click anywhere on the bubble
//
// The menu floats at a fixed pixel position (passed in via `anchor`)
// with viewport-edge clamping so it never hangs off the screen. A
// click on the dark backdrop closes it.
//
// Phase 4 will grow this with reply / react / edit / forward / delete
// for everyone. The component takes an array of action items so each
// stage can add an entry without restructuring the menu itself.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

// Extra emojis surfaced when the user taps "+" on the strip — keeps
// the default row short for one-tap reactions while still giving
// access to a fuller picker without a heavyweight library.
const EXTRA_EMOJIS = [
  // Faces
  "😎", "🤣", "😍", "🥰", "😘", "😋",
  "🤪", "🤔", "🙄", "😴", "🥱", "🤤",
  "😏", "😬", "🤐", "🤫", "🤥", "😳",
  "🥺", "😭", "🤯", "😱", "😨", "😰",
  "😡", "🤬", "🤢", "🤮", "🤧", "😷",
  // Hands + gestures
  "👏", "🙏", "💪", "👊", "🤝", "🫶",
  "🤞", "✌️", "🤘", "👌", "🤌", "🤏",
  "🫡", "🫤", "🫥", "🤲", "👋", "🤙",
  // Hearts + symbols
  "💖", "💕", "💗", "💘", "💝", "💜",
  "🧡", "💛", "💚", "💙", "🖤", "🤍",
  "💯", "🔥", "✨", "⚡", "🎉", "🎊",
  "✅", "❌", "⭐", "💫", "💥", "💢",
  // Misc
  "👀", "💀", "👻", "🤖", "🤡", "👽",
];

export interface MenuAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  // When false the entry is skipped entirely. Useful for "Edit" /
  // "Delete for everyone" being mine-only without forking the menu.
  visible?: boolean;
}

interface Props {
  anchor: { x: number; y: number };
  actions: MenuAction[];
  onClose: () => void;
  // Optional row of common emojis pinned to the top of the menu —
  // tap to toggle a reaction. WhatsApp-style. `myEmoji` lets us
  // highlight the one the current user has already reacted with so
  // re-tapping it removes the reaction.
  reactionEmojis?: string[];
  myEmoji?: string | null;
  onReact?: (emoji: string) => void;
}

const MARGIN = 8;
// Reserve more space at the bottom than at the other edges so the menu
// never crowds the home indicator / soft-nav bar when the long-pressed
// message is near the bottom of the viewport. The previous 8px gap let
// the menu hug the bottom edge and felt cramped; ~72px keeps a
// comfortable visual buffer above the home indicator on iOS and the
// nav bar on Android. env(safe-area-inset-bottom) is read at clamp
// time via window.innerHeight - safe inset.
const BOTTOM_MARGIN = 72;
const MENU_WIDTH = 220;

export function MessageActionMenu({
  anchor,
  actions,
  onClose,
  reactionEmojis,
  myEmoji,
  onReact,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [emojiExpanded, setEmojiExpanded] = useState(false);

  // Clamp the menu inside the viewport. We measure the menu after
  // first paint (useLayoutEffect → before the user sees a flash) and
  // shift it back inside if the anchor is too close to the edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = anchor.x;
    let top = anchor.y;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left + rect.width + MARGIN > vw) {
      left = Math.max(MARGIN, vw - rect.width - MARGIN);
    }
    if (top + rect.height + BOTTOM_MARGIN > vh) {
      top = Math.max(MARGIN, vh - rect.height - BOTTOM_MARGIN);
    }
    if (left < MARGIN) left = MARGIN;
    if (top < MARGIN) top = MARGIN;
    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visible = actions.filter((a) => a.visible !== false);

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/30 backdrop-blur-md"
      onClick={onClose}
      onContextMenu={(e) => {
        // A right-click on the backdrop shouldn't open the OS menu —
        // it should just close ours. The right-click that OPENED the
        // menu was on the bubble itself; another right-click is the
        // user dismissing.
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        className="absolute rounded-xl bg-[var(--glass-card-bg)] border border-[var(--glass-border-sm)] shadow-2xl overflow-hidden peja-fade-in-scale"
        style={{
          width: MENU_WIDTH,
          // Initial render off-screen so the user doesn't see a flash
          // at (0,0) before useLayoutEffect commits the real position.
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {reactionEmojis && reactionEmojis.length > 0 && onReact && (
          <div className="border-b border-[var(--chat-input-border)]">
            <div className="flex items-center justify-around px-2 py-2">
              {reactionEmojis.map((emoji) => {
                const mine = myEmoji === emoji;
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onReact(emoji);
                      onClose();
                    }}
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-xl active:scale-95 transition-transform ${
                      mine ? "bg-primary-500/25 ring-1 ring-primary-400" : ""
                    }`}
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setEmojiExpanded((v) => !v)}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-dark-200 hover:bg-[var(--chat-input-hover)] transition-colors ${
                  emojiExpanded ? "bg-[var(--chat-input-hover)]" : ""
                }`}
                aria-label="More reactions"
                aria-expanded={emojiExpanded}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {emojiExpanded && (
              <div className="grid grid-cols-6 gap-1 px-2 pb-2 max-h-64 overflow-y-auto peja-fade-in-scale">
                {EXTRA_EMOJIS.map((emoji) => {
                  const mine = myEmoji === emoji;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onReact(emoji);
                        onClose();
                      }}
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-xl active:scale-95 transition-transform ${
                        mine ? "bg-primary-500/25 ring-1 ring-primary-400" : ""
                      }`}
                      aria-label={`React ${emoji}`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {visible.map((a) => (
          <button
            key={a.key}
            type="button"
            role="menuitem"
            onClick={() => {
              a.onClick();
              onClose();
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-[var(--chat-input-hover)] transition-colors ${
              a.danger ? "text-red-400" : "text-dark-100"
            }`}
          >
            <span className="shrink-0">{a.icon}</span>
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
