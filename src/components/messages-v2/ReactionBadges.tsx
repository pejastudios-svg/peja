"use client";

// Floating cluster of reaction badges anchored to the bottom-right
// (mine) or bottom-left (theirs) of a message bubble. Each badge
// shows an emoji + count for that emoji on this message. The badge
// the current user is responsible for gets a primary-tinted ring so
// you can tell at a glance "I did this one".
//
// Tap a badge: same as tapping that emoji in the action menu — it
// toggles the current user's reaction with that emoji.
//
// The pop-in animation (peja-pop-in defined in globals.css) is
// applied per-badge so a brand new reaction springs in rather than
// just appearing. We key by `emoji` so React only re-runs the
// animation on actually new emoji buckets, not when a count changes.

import type { MessageReaction } from "@/features/chat/types";

interface Props {
  reactions: MessageReaction[];
  currentUserId: string | null;
  variant: "mine" | "theirs";
  onToggle: (emoji: string) => void;
}

export function ReactionBadges({
  reactions,
  currentUserId,
  variant,
  onToggle,
}: Props) {
  if (reactions.length === 0) return null;

  // Group by emoji, count, and remember whether the current user is
  // among the reactors for each emoji bucket.
  const buckets = new Map<
    string,
    { emoji: string; count: number; mine: boolean }
  >();
  for (const r of reactions) {
    const b = buckets.get(r.emoji);
    if (b) {
      b.count += 1;
      if (r.user_id === currentUserId) b.mine = true;
    } else {
      buckets.set(r.emoji, {
        emoji: r.emoji,
        count: 1,
        mine: r.user_id === currentUserId,
      });
    }
  }
  const ordered = Array.from(buckets.values());

  const align = variant === "mine" ? "justify-end" : "justify-start";

  return (
    <div className={`flex ${align} mt-0.5 -mb-1 ml-1 mr-1`}>
      <div className="flex flex-wrap items-center gap-1">
        {ordered.map((b) => (
          <button
            key={b.emoji}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(b.emoji);
            }}
            className={`peja-pop-in inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] leading-none transition-transform active:scale-95 ${
              b.mine
                ? "bg-primary-500/25 ring-1 ring-primary-400 text-dark-100"
                : "bg-[var(--chat-other-bg)] text-dark-100"
            }`}
            aria-label={`${b.emoji} ${b.count}`}
          >
            <span>{b.emoji}</span>
            {b.count > 1 && (
              <span className="text-[10px] tabular-nums text-dark-300">
                {b.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
