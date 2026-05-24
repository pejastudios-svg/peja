"use client";

import { Hash, X } from "lucide-react";

interface ReportTagsFieldProps {
  tagInput: string;
  tags: string[];
  onTagInputChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
}

export function ReportTagsField({
  tagInput,
  tags,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
}: ReportTagsFieldProps) {
  return (
    <section className="report-section">
      <h2 className="report-section-title">Tags</h2>
      <p className="report-section-hint">Optional — press Enter to add each tag.</p>
      <div className="peja-input-icon-wrap">
        <Hash className="peja-input-icon" aria-hidden />
        <input
          type="text"
          value={tagInput}
          onChange={(e) => onTagInputChange(e.target.value)}
          placeholder="e.g. lekki, traffic, armed"
          className="peja-input"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddTag();
            }
          }}
        />
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium max-w-full"
              style={{
                background: "var(--soft-surface)",
                border: "1px solid var(--border-subtle)",
                color: "var(--color-primary-400)",
              }}
            >
              <span className="truncate">#{tag}</span>
              <button
                type="button"
                onClick={() => onRemoveTag(tag)}
                className="shrink-0 p-0.5 rounded-full active:opacity-70"
                aria-label={`Remove ${tag}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
