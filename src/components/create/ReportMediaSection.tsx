"use client";

import type { RefObject } from "react";
import { Camera, Video, Upload, X, Play, Loader2 } from "lucide-react";

export interface MediaPreviewItem {
  url: string;
  type: string;
}

interface ReportMediaSectionProps {
  mediaCountText: string;
  media: File[];
  mediaPreviews: MediaPreviewItem[];
  cameraInputRef: RefObject<HTMLInputElement | null>;
  videoInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenRecorder: () => void;
  onRemoveMedia: (index: number) => void;
  getUploadStatus: (file: File) => "uploading" | "done" | "failed" | undefined;
  getUploadProgress: (file: File) => number;
  getUploadError: (file: File) => string | undefined;
  /** Bumps on pre-upload progress so upload overlays re-render */
  preUploadTick?: number;
}

export function ReportMediaSection({
  mediaCountText,
  media,
  mediaPreviews,
  cameraInputRef,
  videoInputRef,
  onFileSelect,
  onOpenRecorder,
  onRemoveMedia,
  getUploadStatus,
  getUploadProgress,
  getUploadError,
  preUploadTick,
}: ReportMediaSectionProps) {
  void preUploadTick;
  return (
    <section className="report-section">
      <div className="flex items-center justify-between mb-1">
        <h2 className="report-section-title mb-0">Evidence</h2>
        <span className="text-xs text-dark-500 tabular-nums">{mediaCountText}</span>
      </div>
      <p className="report-section-hint">Add photos or video from the scene. At least one file is required.</p>

      <input
        type="file"
        ref={cameraInputRef}
        onChange={onFileSelect}
        accept="image/*"
        capture="environment"
        className="hidden"
      />
      <input
        type="file"
        ref={videoInputRef}
        onChange={onFileSelect}
        accept="video/*"
        className="hidden"
      />

      {mediaPreviews.length > 0 && (
        <div className="report-media-strip">
          {mediaPreviews.map((preview, index) => {
            const file = media[index];
            const status = file ? getUploadStatus(file) : undefined;
            const progress = file ? getUploadProgress(file) : 0;
            const errMsg = file ? getUploadError(file) : undefined;

            return (
              <div key={index} className="report-media-thumb">
                {preview.type === "video" ? (
                  <div className="relative w-full h-full">
                    {preview.url ? (
                      <img src={preview.url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-dark-800">
                        <Video className="w-5 h-5 text-dark-500" />
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Play className="w-4 h-4 text-white" />
                    </div>
                  </div>
                ) : (
                  <img src={preview.url} alt="" className="w-full h-full object-cover" />
                )}
                {status === "uploading" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/55 z-20">
                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                    <span className="text-[9px] font-mono tabular-nums text-white/90">{progress}%</span>
                  </div>
                )}
                {status === "failed" && (
                  <div
                    className="absolute inset-x-0 bottom-0 bg-red-500/90 text-[8px] text-white text-center py-0.5 px-0.5 z-20 truncate"
                    title={errMsg || "Upload failed"}
                  >
                    Failed
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveMedia(index)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/75 flex items-center justify-center z-10"
                  aria-label="Remove"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="report-media-chip"
        >
          <Camera className="w-4 h-4 text-primary-500" />
          Photo
        </button>
        <button type="button" onClick={onOpenRecorder} className="report-media-chip report-media-chip--record">
          <Video className="w-4 h-4" />
          Record
        </button>
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          className="report-media-chip"
        >
          <Upload className="w-4 h-4 text-primary-500" />
          Library
        </button>
      </div>
    </section>
  );
}
