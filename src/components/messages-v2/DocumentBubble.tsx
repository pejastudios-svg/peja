"use client";

// Inline document/file bubble for a chat message.
//
// Two render branches, deliberately split:
//
//   1. **Pending upload** — the outer container is a plain <div>. The
//      icon slot holds an UploadRing whose centre is itself a <button>
//      (the X to cancel). Nested <button> elements are invalid HTML
//      and several browsers (incl. the Capacitor WebView) silently
//      drop the inner click — that was the "cancel doesn't work for
//      docs" bug.
//
//   2. **Settled** — the outer container is a <button> so the entire
//      bubble is a single tap target that opens the in-app viewer.
//
// Layout mirrors AudioBubble:
//
//   ┌──────────┬──────────────────────────────────┐
//   │          │  PEJA content package d.pdf       │
//   │   📄      │                                   │
//   │  (icon)  │  395 KB                  18:51 ✓✓ │
//   └──────────┴──────────────────────────────────┘
//
// `items-center` on the outer flex vertically centres the icon
// against the whole right column (filename + size+meta), so the
// icon sits at the bubble's geometric centre instead of looking
// top-heavy with the meta row dangling below.
//
// We intentionally don't try to preview the file inline (no PDF
// thumbnail, no docx render). The viewer modal handles the preview.

import { FileText } from "lucide-react";
import { UploadRing } from "./UploadRing";

interface Props {
  url: string;
  fileName: string;
  fileSize: number | null;
  variant: "mine" | "theirs";
  isPending?: boolean;
  isFailed?: boolean;
  uploadFraction?: number;
  onCancelUpload?: () => void;
  onOpen?: () => void;
  // Optional message-meta line (timestamp + ✓ ticks) rendered in the
  // bottom-right of the bubble's right column. When provided, the
  // parent should NOT also render its own status row underneath the
  // bubble — that stacked-meta layout pushes the icon off centre.
  metaTrailing?: React.ReactNode;
}

export function DocumentBubble({
  url,
  fileName,
  fileSize,
  variant,
  isPending,
  isFailed,
  uploadFraction,
  onCancelUpload,
  onOpen,
  metaTrailing,
}: Props) {
  const iconBg =
    variant === "mine" ? "bg-white/25" : "bg-[var(--chat-control-other-bg)]";
  const iconFg = variant === "mine" ? "text-white" : "text-dark-100";
  const sizeFg = variant === "mine" ? "text-white/75" : "text-dark-400";

  const sizeLabel = fileSize ? formatBytes(fileSize) : null;

  const iconSlot = isPending ? (
    <span className="shrink-0 w-10 h-10 flex items-center justify-center">
      <UploadRing
        fraction={uploadFraction ?? 0}
        size={40}
        onCancel={onCancelUpload}
      />
    </span>
  ) : (
    <span
      className={`shrink-0 w-10 h-10 rounded-lg ${iconBg} ${iconFg} flex items-center justify-center`}
      aria-hidden
    >
      <FileText className="w-5 h-5" />
    </span>
  );

  const body = (
    <div className="flex-1 min-w-0 flex flex-col">
      <span className="text-sm truncate">{fileName}</span>
      <div
        className={`flex items-center justify-between gap-2 text-[11px] tabular-nums ${sizeFg}`}
      >
        <span className="truncate">{sizeLabel ?? ""}</span>
        {metaTrailing && (
          <span className="flex items-center gap-1 shrink-0">
            {metaTrailing}
          </span>
        )}
      </div>
    </div>
  );

  if (isPending) {
    return (
      <div className="flex items-center gap-2.5 min-w-[220px] max-w-full">
        {iconSlot}
        {body}
      </div>
    );
  }

  const handleClick = () => {
    if (isFailed) return;
    if (onOpen) {
      onOpen();
      return;
    }
    // Fallback (no viewer wired): open in a new tab.
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isFailed}
      className="flex items-center gap-2.5 min-w-[220px] max-w-full text-left"
    >
      {iconSlot}
      {body}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
