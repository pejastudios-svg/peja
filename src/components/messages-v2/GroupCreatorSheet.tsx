"use client";

// Peja-only group-chat creation sheet. Two-pane slide-in panel,
// same animation family as NewDMSheet / IncidentForwardSheet so the
// chrome feels consistent. Lives at z-[1000] via createPortal so it
// escapes the FAB stacking context.
//
// Flow:
//   1. Name (required) + optional avatar URL.
//   2. Pick members — only elevated users (MVP / VIP / admin) show
//      in the picker, mirroring the new-DM gate. Peja is added as
//      owner automatically server-side and is not selectable here.
//   3. Create → server-side `peja_create_group` RPC → navigate to
//      the new thread.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Search,
  Star,
  Crown,
  Check,
  Users,
  Camera,
  X as XIcon,
} from "lucide-react";
import { AvatarImage } from "@/components/ui/AvatarImage";
import {
  fetchVisibleElevatedUsers,
  fetchConversationList,
  createGroup,
  uploadGroupAvatar,
  PermissionDeniedError,
  type VisibleElevatedUser,
} from "@/features/chat/api";
import { useChatStore } from "@/features/chat/store";
import { useToast } from "@/context/ToastContext";

interface Props {
  currentUserId: string;
  onClose: () => void;
}

export function GroupCreatorSheet({ currentUserId, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  // Avatar lives as a local File until the user taps Create — at
  // which point we upload it, then call createGroup with the
  // returned public URL. We hold a blob: preview URL so the user
  // sees their picked image immediately without round-tripping
  // through Storage.
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [people, setPeople] = useState<VisibleElevatedUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // 5 MB ceiling — the group avatar is a thumbnail; bigger files
    // are almost always camera-roll originals the user didn't mean
    // to send full-resolution.
    if (f.size > 5 * 1024 * 1024) {
      toast.danger("Image too large. Pick one under 5 MB.");
      e.target.value = "";
      return;
    }
    if (!f.type.startsWith("image/")) {
      toast.danger("Pick an image file.");
      e.target.value = "";
      return;
    }
    setAvatarFile(f);
  };

  useEffect(() => {
    let cancelled = false;
    fetchVisibleElevatedUsers(currentUserId)
      .then((rows) => {
        if (!cancelled) setPeople(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[GroupCreatorSheet] load failed", err);
        setLoadError(err?.message || "Failed to load users");
        setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const filtered = useMemo(() => {
    if (!people) return null;
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((u) =>
      (u.full_name || "").toLowerCase().includes(q)
    );
  }, [people, query]);

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

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.danger("Give the group a name.");
      return;
    }
    if (selected.size === 0) {
      toast.danger("Add at least one member.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      // Upload the avatar first (if any) so we can pass a stable
      // URL to peja_create_group in a single round-trip. If the
      // upload fails we still create the group — the avatar is
      // entirely optional and the owner can set one later from
      // the chat-info sheet.
      let uploadedUrl: string | null = null;
      if (avatarFile) {
        try {
          uploadedUrl = await uploadGroupAvatar(avatarFile, currentUserId);
        } catch (err) {
          console.warn("[GroupCreatorSheet] avatar upload failed", err);
          toast.danger("Couldn't upload that image; creating group without an avatar.");
        }
      }
      const convId = await createGroup({
        name: trimmedName,
        avatarUrl: uploadedUrl,
        memberIds: Array.from(selected),
      });
      // Refresh the conversation list BEFORE we navigate so the
      // thread page reads the new group out of the store on mount
      // instead of rendering with a generic "Chat" header until the
      // next realtime SUBSCRIBED event refetches it for us.
      try {
        const list = await fetchConversationList(currentUserId);
        useChatStore.getState().setConversations(list);
      } catch {
        /* the next realtime SUBSCRIBED will fix this */
      }
      // Slide out then navigate so the next screen's enter animation
      // doesn't race with our exit.
      setClosing(true);
      window.setTimeout(() => {
        onClose();
        router.push(`/messages/${convId}`);
      }, 180);
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        toast.danger("Only the peja account can create groups.");
      } else {
        const msg =
          e instanceof Error ? e.message : "Couldn't create group.";
        toast.danger(msg);
      }
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
      {/* Header: respects safe-area top inset so the title doesn't sit
          under the notch / status bar. */}
      <header
        className="shrink-0 border-b border-[var(--chat-input-border)]"
        style={{
          paddingTop: "var(--app-top-inset, env(safe-area-inset-top, 0px))",
        }}
      >
        <div className="flex items-center gap-3 px-3 h-14">
          <button
            type="button"
            onClick={handleClose}
            className="w-9 h-9 rounded-full bg-[var(--chat-input-bg)] flex items-center justify-center"
            aria-label="Close"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary-300" />
            <span className="text-base font-semibold text-dark-100">
              New group
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-semibold text-dark-500 mb-1.5">
            Group name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            placeholder="e.g. Lagos Mainland Response"
            className="w-full h-10 rounded-xl bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] px-3 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
          />
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wider font-semibold text-dark-500 mb-1.5">
            Group photo <span className="text-dark-500 normal-case font-normal">(optional)</span>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 relative w-16 h-16 rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center group"
              aria-label={avatarPreview ? "Change group photo" : "Pick a group photo"}
            >
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <Camera className="w-5 h-5 text-dark-300" />
              )}
              <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Camera className="w-5 h-5 text-white" />
              </span>
            </button>
            <div className="flex-1 min-w-0 flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-primary-300 font-medium"
              >
                {avatarPreview ? "Change photo" : "Choose from gallery"}
              </button>
              {avatarPreview && (
                <button
                  type="button"
                  onClick={() => setAvatarFile(null)}
                  className="inline-flex items-center gap-1 text-[11px] text-dark-400 hover:text-dark-200"
                >
                  <XIcon className="w-3 h-3" />
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePickFile}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-dark-500">
              Members
            </label>
            {selected.size > 0 && (
              <span className="text-[11px] text-dark-400">
                {selected.size} selected
              </span>
            )}
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find someone to add"
              className="w-full h-10 rounded-xl bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] pl-9 pr-3 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
            />
          </div>

          {people === null ? (
            <p className="text-sm text-dark-400 text-center py-8">Loading…</p>
          ) : loadError ? (
            <div className="text-center py-8 px-4">
              <p className="text-sm text-dark-200 mb-1">
                Couldn&rsquo;t load the user list.
              </p>
              <p className="text-[11px] text-dark-500 font-mono break-words">
                {loadError}
              </p>
            </div>
          ) : people.length === 0 ? (
            <p className="text-sm text-dark-400 text-center py-8 px-4">
              No elevated users to add yet. Promote someone to MVP or
              VIP first.
            </p>
          ) : filtered && filtered.length === 0 ? (
            <p className="text-sm text-dark-400 text-center py-8">
              No matches for &ldquo;{query}&rdquo;.
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
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-[var(--chat-input-border)] bg-[var(--page-bg)]">
        <button
          type="button"
          onClick={handleCreate}
          disabled={
            submitting || !name.trim() || selected.size === 0
          }
          className="w-full h-11 rounded-xl bg-primary-600 text-white font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting
            ? "Creating…"
            : `Create group${selected.size > 0 ? ` (${selected.size + 1})` : ""}`}
        </button>
      </div>
    </div>,
    document.body
  );
}
