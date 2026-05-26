"use client";

// "Add member" picker shown from the chat-info sheet's Members
// tab. Lists elevated users the owner doesn't already have in the
// group, with multi-select + a single Add CTA. Server-side
// `peja_group_add_member` is owner-gated, so attempting to call
// this as a member surfaces a friendly error.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Search, Star, Crown, Check } from "lucide-react";
import { AvatarImage } from "@/components/ui/AvatarImage";
import {
  fetchVisibleElevatedUsers,
  addGroupMember,
  PermissionDeniedError,
  type VisibleElevatedUser,
} from "@/features/chat/api";
import { useToast } from "@/context/ToastContext";

interface Props {
  conversationId: string;
  currentUserId: string;
  existingMemberIds: Set<string>;
  onClose: () => void;
  onAdded: (count: number) => void | Promise<void>;
}

export function AddMemberSheet({
  conversationId,
  currentUserId,
  existingMemberIds,
  onClose,
  onAdded,
}: Props) {
  const toast = useToast();
  const [people, setPeople] = useState<VisibleElevatedUser[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchVisibleElevatedUsers(currentUserId)
      .then((rows) => {
        if (!cancelled) setPeople(rows);
      })
      .catch((err) => {
        console.error("[AddMemberSheet] load failed", err);
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const filtered = useMemo(() => {
    if (!people) return null;
    const q = query.trim().toLowerCase();
    return people
      .filter((u) => !existingMemberIds.has(u.id))
      .filter((u) => !q || (u.full_name || "").toLowerCase().includes(q));
  }, [people, query, existingMemberIds]);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose(), 200);
  }, [closing, onClose]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      const ids = Array.from(selected);
      const results = await Promise.allSettled(
        ids.map((uid) => addGroupMember(conversationId, uid))
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = ids.length - succeeded;
      if (succeeded > 0) {
        toast.info(
          succeeded === 1 ? "1 member added" : `${succeeded} members added`
        );
      }
      if (failed > 0) {
        const firstReason = results.find((r) => r.status === "rejected");
        const reason =
          firstReason && firstReason.status === "rejected"
            ? firstReason.reason instanceof PermissionDeniedError
              ? "Only the peja account can add members"
              : firstReason.reason?.message || "Some adds failed"
            : "Some adds failed";
        toast.danger(reason);
      }
      await onAdded(succeeded);
      handleClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't add members";
      toast.danger(msg);
      setSubmitting(false);
    }
  };

  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      onClick={(e) => e.stopPropagation()}
      className={`fixed inset-0 z-[1000] bg-[var(--page-bg)] flex flex-col overflow-hidden ${
        closing ? "peja-slide-out-to-right" : "peja-slide-in-from-right"
      }`}
    >
      <header className="shrink-0 flex items-center gap-3 px-3 h-14 border-b border-[var(--chat-input-border)]">
        <button
          type="button"
          onClick={handleClose}
          className="w-9 h-9 rounded-full bg-[var(--chat-input-bg)] flex items-center justify-center"
          aria-label="Close"
        >
          <ArrowLeft className="w-5 h-5 text-dark-200" />
        </button>
        <span className="text-base font-semibold text-dark-100">
          Add members
        </span>
      </header>

      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find someone to add"
            className="w-full h-10 rounded-xl bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] pl-9 pr-3 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {people === null ? (
          <p className="text-sm text-dark-400 text-center py-12">Loading…</p>
        ) : filtered && filtered.length === 0 ? (
          <p className="text-sm text-dark-400 text-center py-12 px-4">
            {query.trim()
              ? `No matches for "${query}".`
              : "Everyone elevated is already a member."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {(filtered ?? []).map((u) => {
              const isSelected = selected.has(u.id);
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => toggle(u.id)}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[var(--chat-input-hover)] text-left"
                  >
                    <AvatarImage
                      src={u.avatar_url}
                      wrapperClassName="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center"
                      fallbackIconClassName="w-5 h-5"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-dark-100 truncate">
                        {u.full_name || "User"}
                      </span>
                      <span className="inline-flex items-center gap-1 mt-0.5">
                        {u.is_mvp && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full peja-badge-mvp">
                            <Star className="w-2.5 h-2.5" />
                            MVP
                          </span>
                        )}
                        {u.is_vip && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full peja-badge-vip">
                            <Crown className="w-2.5 h-2.5" />
                            VIP
                          </span>
                        )}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center border ${
                        isSelected
                          ? "bg-primary-600 border-primary-600 text-white"
                          : "border-[var(--chat-input-border)]"
                      }`}
                      aria-hidden
                    >
                      {isSelected && <Check className="w-4 h-4" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-[var(--chat-input-border)] bg-[var(--page-bg)]">
        <button
          type="button"
          onClick={handleAdd}
          disabled={selected.size === 0 || submitting}
          className="w-full h-11 rounded-xl bg-primary-600 text-white font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting
            ? "Adding…"
            : selected.size === 0
              ? "Pick members to add"
              : `Add ${selected.size} member${selected.size > 1 ? "s" : ""}`}
        </button>
      </div>
    </div>,
    document.body
  );
}
