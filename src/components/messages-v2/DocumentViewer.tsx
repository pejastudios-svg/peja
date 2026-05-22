"use client";

// Fullscreen in-app document viewer.
//
// Renders the file in an <iframe>. Browsers natively preview common
// types (PDF, plain text, images) inside iframes; for types they
// can't render (docx, xlsx, etc.) the iframe shows a download
// prompt — that's acceptable as a v1, and the long-press menu
// (Phase 4) will give an explicit "Download" action regardless.
//
// We deliberately keep this minimal: a header bar with the filename
// and a close button, and the iframe filling the rest. No download
// button here — download lives in the long-press action menu per
// the spec.

import { X } from "lucide-react";

interface Props {
  url: string;
  fileName: string;
  onClose: () => void;
}

export function DocumentViewer({ url, fileName, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col">
      <div className="flex items-center gap-3 px-4 h-14 border-b border-white/10 bg-black/60 text-white">
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="flex-1 min-w-0 truncate text-sm">{fileName}</span>
      </div>
      <iframe
        src={url}
        title={fileName}
        className="flex-1 w-full bg-white"
      />
    </div>
  );
}
