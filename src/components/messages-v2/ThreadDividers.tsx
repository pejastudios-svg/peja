"use client";

// Two small, single-purpose dividers that interleave with messages
// in the v2 thread render to give it visual rhythm.
//
//   • DateDivider — pill with "Today" / "Yesterday" / "Month D" /
//     "Month D, YYYY" for the day a group of messages was sent. The
//     thread page inserts one of these between any two consecutive
//     messages whose calendar date differs.
//
//   • UnreadDivider — a thin horizontal rule with an "Unread messages"
//     chip in the middle. The thread page inserts ONE of these
//     before the first incoming message that arrived after the
//     user's snapshotted last_read_at, snapshotted at mount so the
//     divider stays put even as new messages stream in.
//
// Both are pure presentational — all the logic for WHEN to insert
// them lives in the thread page (see buildThreadItems).

import { format, isSameDay, isYesterday } from "date-fns";

interface DateDividerProps {
  iso: string;
}

export function DateDivider({ iso }: DateDividerProps) {
  const d = new Date(iso);
  const now = new Date();
  let label: string;
  if (isSameDay(d, now)) {
    label = "Today";
  } else if (isYesterday(d)) {
    label = "Yesterday";
  } else if (d.getFullYear() === now.getFullYear()) {
    label = format(d, "MMMM d");
  } else {
    label = format(d, "MMMM d, yyyy");
  }
  return (
    <div className="flex justify-center my-3" aria-hidden>
      <span className="text-[11px] font-medium text-dark-300 bg-[var(--chat-other-bg)] rounded-full px-2.5 py-1">
        {label}
      </span>
    </div>
  );
}

export function UnreadDivider() {
  return (
    <div className="flex items-center gap-2 my-3" aria-hidden>
      <span className="flex-1 h-px bg-primary-500/50" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary-400">
        Unread messages
      </span>
      <span className="flex-1 h-px bg-primary-500/50" />
    </div>
  );
}

/**
 * Returns the calendar "bucket" string for a given ISO timestamp —
 * an identifier used by buildThreadItems to decide whether two
 * consecutive messages belong to the same date group. The exact
 * format doesn't matter; what matters is that timestamps on the
 * same calendar day map to the same value.
 */
export function dateBucket(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
