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
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJumpToOriginal?.();
      }}
      // min-w-0 + max-w-full: when the parent message has an unbroken
      // long token, the inner truncate <p>'s intrinsic min-content equals
      // the whole string, which a content-sized bubble would happily
      // grow to. min-w-0 lets the block shrink past that intrinsic
      // min-content so the bubble can hold its own 78% cap on first
      // render — no momentary stretch-then-shrink.
      className={`block w-full min-w-0 max-w-full text-left rounded-md ${surface} border-l-2 ${accentBorder} px-2 py-1.5 mb-1 active:opacity-80`}
    >
      <p
        className="text-[11px] font-semibold truncate"
        style={{
          // "mine" sits on a colored bubble where white reads cleanly;
          // "theirs" uses the theme-aware purple token so the label stays
          // readable on both dark and light reply surfaces.
          color:
            variant === "mine" ? "#ffffff" : "var(--chat-reply-author)",
        }}
      >
        {authorName}
      </p>
      <ReplyContentSnippet target={target} />
    </button>
  );
}
