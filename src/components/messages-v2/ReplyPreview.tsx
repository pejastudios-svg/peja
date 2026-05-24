"use client";

// Small preview row that appears above the composer when the user is
// replying to a message. Shows who they're replying to + a one-line
// snippet of the parent. Tap × to dismiss the reply context.
//
// Used in two surfaces with slightly different chrome:
//   • Composer (above textarea) — full-width with X button
//   • Inside a sent message bubble — read-only, no X, sits above the
//     content (rendered by QuotedReplyBlock).

import { X, Image as ImageIcon, Video, Mic, FileText } from "lucide-react";
import type { ReplyTarget } from "@/features/chat/types";

interface Props {
  target: ReplyTarget;
  authorName: string;
  onDismiss: () => void;
}

export function ReplyPreview({ target, authorName, onDismiss }: Props) {
  return (
    <div className="max-w-2xl mx-auto mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--chat-input-bg)] border-l-2 border-primary-500">
      <div className="flex-1 min-w-0">
        <p
          className="text-[11px] font-semibold truncate"
          style={{ color: "var(--chat-reply-author)" }}
        >
          Replying to {authorName}
        </p>
        <ReplyContentSnippet target={target} />
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 w-7 h-7 rounded-full bg-[var(--chat-input-hover)] flex items-center justify-center"
        aria-label="Cancel reply"
      >
        <X className="w-3.5 h-3.5 text-dark-200" />
      </button>
    </div>
  );
}

/**
 * One-line preview of the parent message. For text-only parents:
 * the text snippet. For media-only parents: an icon + media-type
 * label ("📷 Photo", "🎙 Voice note", etc.) — same as WhatsApp.
 */
export function ReplyContentSnippet({ target }: { target: ReplyTarget }) {
  if (target.is_deleted) {
    return (
      <p className="text-xs text-dark-400 italic truncate">Message deleted</p>
    );
  }
  if (target.preview_kind === "text") {
    return (
      <p className="text-xs text-dark-300 truncate">
        {target.content || ""}
      </p>
    );
  }
  const { icon, label } = mediaPreviewBits(target.preview_kind);
  return (
    <p className="text-xs text-dark-300 truncate inline-flex items-center gap-1">
      {icon}
      <span>{target.content?.trim() ? target.content : label}</span>
    </p>
  );
}

function mediaPreviewBits(kind: ReplyTarget["preview_kind"]): {
  icon: React.ReactNode;
  label: string;
} {
  switch (kind) {
    case "image":
      return { icon: <ImageIcon className="w-3.5 h-3.5" />, label: "Photo" };
    case "video":
      return { icon: <Video className="w-3.5 h-3.5" />, label: "Video" };
    case "audio":
      return { icon: <Mic className="w-3.5 h-3.5" />, label: "Voice note" };
    case "document":
      return { icon: <FileText className="w-3.5 h-3.5" />, label: "File" };
    default:
      return { icon: null, label: "" };
  }
}
