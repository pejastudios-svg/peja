"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Download,
  ExternalLink,
  Loader2,
  FileText,
} from "lucide-react";

interface DocumentViewerProps {
  isOpen: boolean;
  onClose: () => void;
  url: string | null;
  fileName: string | null;
  fileSize?: number | null;
}

function getFileExtension(fileName: string | null): string {
  if (!fileName) return "";
  return fileName.split(".").pop()?.toLowerCase() || "";
}

function getCleanUrl(url: string, fileName: string | null): string {
  const name = fileName || "document";
  return `/api/file?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
}

function getDocIcon(fileName: string | null): string {
  if (!fileName) return "📄";
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "📕",
    doc: "📘",
    docx: "📘",
    txt: "📝",
    xlsx: "📊",
    xls: "📊",
    pptx: "📙",
    ppt: "📙",
    zip: "📦",
    rar: "📦",
    csv: "📊",
    json: "📋",
  };
  return map[ext] || "📄";
}

export function DocumentViewer({
  isOpen,
  onClose,
  url,
  fileName,
  fileSize,
}: DocumentViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (!isOpen || !url) return null;

  const ext = getFileExtension(fileName);
  const cleanUrl = getCleanUrl(url, fileName);
  const safeName = fileName || "document";

  // Determine what can be viewed inline
  const isPdf = ext === "pdf";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext);
  const isText = ["txt", "csv", "json", "md"].includes(ext);
  const canPreview = isPdf || isImage || isText;

  const handleDownload = () => {
    // Force download via the proxy with attachment disposition
    const downloadUrl = `/api/file?url=${encodeURIComponent(url)}&name=${encodeURIComponent(safeName)}&download=1`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = safeName;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleOpenExternal = () => {
    // Open in new tab via proxy — URL shows /api/file?name=document.pdf
    window.open(cleanUrl, "_blank", "noopener,noreferrer");
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex flex-col bg-[#0a0812] animate-in fade-in duration-200"
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 shrink-0 border-b border-white/5 bg-[#0d0a14]"
        style={{
          height: "calc(3.5rem + env(safe-area-inset-top, 0px))",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-1.5 -ml-1 hover:bg-white/5 rounded-lg active:scale-95 transition-transform"
          >
            <X className="w-5 h-5 text-dark-200" />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-medium text-dark-100 truncate">
              {safeName}
            </p>
            {fileSize && (
              <p className="text-[11px] text-dark-500">
                {fileSize > 1024 * 1024
                  ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
                  : `${(fileSize / 1024).toFixed(0)} KB`}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleOpenExternal}
            className="p-2 hover:bg-white/5 rounded-lg active:scale-95 transition-transform"
            title="Open in browser"
          >
            <ExternalLink className="w-4.5 h-4.5 text-dark-300" />
          </button>
          <button
            onClick={handleDownload}
            className="p-2 hover:bg-white/5 rounded-lg active:scale-95 transition-transform"
            title="Download"
          >
            <Download className="w-4.5 h-4.5 text-dark-300" />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative">
        {canPreview ? (
          <>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
                  <p className="text-sm text-dark-400">Loading {ext.toUpperCase()}...</p>
                </div>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-3 text-center px-6">
                  <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                    <FileText className="w-8 h-8 text-red-400" />
                  </div>
                  <p className="text-sm text-dark-300">
                    Unable to preview this file
                  </p>
                  <button
                    onClick={handleOpenExternal}
                    className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium active:scale-95 transition-transform"
                  >
                    Open in browser
                  </button>
                </div>
              </div>
            )}

            {isPdf && (
              <iframe
                src={`${cleanUrl}#toolbar=1&navpanes=0`}
                className="w-full h-full border-0"
                title={safeName}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setError(true);
                }}
              />
            )}

            {isImage && (
              <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
                <img
                  src={cleanUrl}
                  alt={safeName}
                  className="max-w-full max-h-full object-contain rounded-lg"
                  onLoad={() => setLoading(false)}
                  onError={() => {
                    setLoading(false);
                    setError(true);
                  }}
                />
              </div>
            )}

            {isText && (
              <iframe
                src={cleanUrl}
                className="w-full h-full border-0 bg-white"
                title={safeName}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setError(true);
                }}
              />
            )}
          </>
        ) : (
          /* Non-previewable file — show info card with open/download options */
          <div className="flex items-center justify-center h-full px-6">
            <div className="text-center max-w-sm">
              <div className="w-24 h-24 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                <span className="text-5xl">{getDocIcon(fileName)}</span>
              </div>
              <h3 className="text-lg font-semibold text-dark-100 mb-1 break-all">
                {safeName}
              </h3>
              {fileSize && (
                <p className="text-sm text-dark-400 mb-6">
                  {fileSize > 1024 * 1024
                    ? `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
                    : `${(fileSize / 1024).toFixed(0)} KB`}
                </p>
              )}
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleOpenExternal}
                  className="w-full py-3 rounded-xl bg-primary-600 text-white text-sm font-medium flex items-center justify-center gap-2 active:scale-95 transition-transform"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open in browser
                </button>
                <button
                  onClick={handleDownload}
                  className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-dark-200 text-sm font-medium flex items-center justify-center gap-2 active:scale-95 transition-transform"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}