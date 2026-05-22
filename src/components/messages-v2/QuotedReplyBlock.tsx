"use client";

// In-bubble quoted-reference block. Rendered above the bubble content
// when a message is a reply. Mirrors WhatsApp / Telegram styling — a
// thin coloured left border, author name on top, one-line preview
// underneath. Tappable so the user can jump to the parent message in
// the thread.

import { ReplyContentSnippet } from "./ReplyPreview";
import type { ReplyTarget } from "@/features/chat/types";

interface Props {
  target: ReplyTarget;
  authorName: string;
  variant: "mine" | "theirs";
  onJumpToOriginal?: () => void;
}

export function QuotedReplyBlock({
  target,
  authorName,
  variant,
  onJumpToOriginal,
}: Props) {
  // Bumped from `bg-white/15` to `bg-white/25` for "mine" — at 15%
  // the inset block was washed out against the purple bubble (esp.
  // in light mode where the purple stays vibrant and the
  // semi-transparent white nearly disappears). 25% reads as a
  // clearly distinct surface while still letting the bubble colour
  // bleed through.
  const accentBorder = variant === "mine" ? "border-white" : "border-primary-400";
  const surface =
    variant === "mine" ? "bg-white/25" : "bg-[var(--chat-control-other-bg)]";
  const authorColor =
    variant === "mine" ? "text-white" : "text-primary-300";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJumpToOriginal?.();
      }}
      className={`block w-full text-left rounded-md ${surface} border-l-2 ${accentBorder} px-2 py-1.5 mb-1 active:opacity-80`}
    >
      <p className={`text-[11px] font-semibold ${authorColor} truncate`}>
        {authorName}
      </p>
      <ReplyContentSnippet target={target} />
    </button>
  );
}
