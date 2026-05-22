"use client";

// Report-user modal. Opens from the chat info sheet's "Report user"
// action and the header kebab's "Report" item. Collects a reason
// (radio-style picker) + optional notes and submits a row to
// `user_reports`. The admin queue at /admin/reports surfaces the
// pending ones.

import { useState } from "react";
import { X } from "lucide-react";
import type { UserReportReason } from "@/features/chat/api";

interface Props {
  reportedName: string;
  onClose: () => void;
  onSubmit: (
    reason: UserReportReason,
    notes: string | null
  ) => Promise<void> | void;
}

interface ReasonOption {
  key: UserReportReason;
  label: string;
  body: string;
}

// Canonical categories surfaced to the user. The DB column is text
// so we can grow this list without a migration; the picker is the
// gate that keeps the values consistent.
const REASONS: ReasonOption[] = [
  {
    key: "spam",
    label: "Spam or scam",
    body: "Unsolicited promotions, fake offers, repeated identical messages.",
  },
  {
    key: "harassment",
    label: "Harassment or bullying",
    body: "Threats, intimidation, repeated unwanted contact.",
  },
  {
    key: "hate",
    label: "Hate speech",
    body: "Discrimination or attacks based on identity.",
  },
  {
    key: "explicit",
    label: "Explicit or violent content",
    body: "Sexual content, graphic violence, gore.",
  },
  {
    key: "impersonation",
    label: "Impersonation",
    body: "This account is pretending to be someone else.",
  },
  {
    key: "self_harm",
    label: "Self-harm or suicide",
    body: "Content suggesting the user may harm themselves.",
  },
  {
    key: "other",
    label: "Something else",
    body: "Use the notes field below to describe what's wrong.",
  },
];

export function ReportUserModal({ reportedName, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState<UserReportReason | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !!reason && !submitting;

  const handleSubmit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(reason, notes.trim() || null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-[var(--glass-card-bg)] border border-[var(--glass-border-sm)] shadow-2xl flex flex-col max-h-[90vh] peja-fade-in-scale"
      >
        <header className="flex items-center gap-3 px-4 h-14 border-b border-[var(--chat-input-border)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--chat-input-bg)] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-dark-200" />
          </button>
          <span className="text-base font-semibold text-dark-100 truncate">
            Report {reportedName}
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <p className="text-sm text-dark-300">
            Tell us what&apos;s wrong. Your report is private; the
            other person isn&apos;t told you reported them.
          </p>

          <ul className="space-y-1.5">
            {REASONS.map((r) => {
              const selected = reason === r.key;
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => setReason(r.key)}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                      selected
                        ? "bg-primary-500/15 ring-1 ring-primary-500/60"
                        : "bg-[var(--chat-input-bg)] hover:bg-[var(--chat-input-hover)]"
                    }`}
                  >
                    <span
                      className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                        selected
                          ? "border-primary-500"
                          : "border-[var(--chat-input-border)]"
                      }`}
                      aria-hidden
                    >
                      {selected && (
                        <span className="w-2 h-2 rounded-full bg-primary-500" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-dark-100">
                        {r.label}
                      </span>
                      <span className="block text-[11px] text-dark-400 mt-0.5">
                        {r.body}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div>
            <label
              htmlFor="report-notes"
              className="block text-xs font-medium text-dark-300 mb-1.5"
            >
              Additional details (optional)
            </label>
            <textarea
              id="report-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Anything else admins should know?"
              className="w-full resize-none rounded-xl bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] px-3 py-2 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
            />
            <p className="text-[10px] text-dark-500 mt-1 text-right tabular-nums">
              {notes.length} / 1000
            </p>
          </div>
        </div>

        <footer className="flex gap-2 justify-end px-4 py-3 border-t border-[var(--chat-input-border)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 h-10 rounded-xl bg-[var(--chat-input-bg)] text-dark-100 text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 h-10 rounded-xl bg-red-600 text-white text-sm font-medium disabled:opacity-40"
          >
            {submitting ? "Submitting…" : "Submit report"}
          </button>
        </footer>
      </div>
    </div>
  );
}
