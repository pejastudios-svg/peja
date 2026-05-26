"use client";

// "Start a new DM" picker. Opens from the conversation-list page's
// floating "+" button. Lists every elevated user the current user
// is allowed to message — VIPs see only VIPs, MVPs see VIPs+MVPs,
// regular users see no one (and shouldn't be able to open this
// sheet at all because the + button is hidden for them upstream).
//
// Tapping a user calls `peja_find_or_create_dm` which:
//   • Verifies the gate (peja_can_dm) server-side, raising 42501
//     if the pair isn't allowed.
//   • Returns the existing conversation id if one already exists
//     between the two users.
//   • Otherwise creates a new conversation + two participants
//     atomically.
//
// The result is a navigation to `/messages/<conversationId>`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, Star, Crown, X } from "lucide-react";
import { AvatarImage } from "@/components/ui/AvatarImage";
import {
  fetchVisibleElevatedUsers,
  findOrCreateDM,
  PermissionDeniedError,
  type VisibleElevatedUser,
} from "@/features/chat/api";
import { useToast } from "@/context/ToastContext";

interface Props {
  currentUserId: string;
  onClose: () => void;
}

export function NewDMSheet({ currentUserId, onClose }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [people, setPeople] = useState<VisibleElevatedUser[] | null>(null);
  // Track whether the load FAILED vs just returned zero rows so the
  // empty state can distinguish "nobody to show" from "RPC blew up
  // and we silently fell back to empty" — the latter was masking
  // missing-migration / permission errors.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchVisibleElevatedUsers(currentUserId)
      .then((rows) => {
        if (!cancelled) setPeople(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          (err && (err.message || err.hint || err.code)) ||
          "Failed to load users";
        // Log full payload — Supabase RPC errors carry .code / .hint
        // that explain whether the function is missing, the user
        // lacks execute grants, etc.
        console.error("[NewDMSheet] fetchVisibleElevatedUsers failed", err);
        setLoadError(String(msg));
        setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    // Autofocus search after the slide-in lands so the keyboard
    // doesn't jump in mid-animation on mobile.
    const t = window.setTimeout(() => inputRef.current?.focus(), 240);
    return () => window.clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    if (!people) return null;
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((u) => (u.full_name || "").toLowerCase().includes(q));
  }, [people, query]);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose(), 220);
  }, [closing, onClose]);

  const handlePick = useCallback(
    async (otherId: string) => {
      if (creatingFor) return;
      setCreatingFor(otherId);
      try {
        const convId = await findOrCreateDM(otherId);
        // Animate out before navigating so the picker doesn't
        // hard-unmount mid-tap. The chat page will then slide in
        // via its own peja-slide-in-from-right class.
        setClosing(true);
        window.setTimeout(() => {
          onClose();
          router.push(`/messages/${convId}`);
        }, 180);
      } catch (e) {
        setCreatingFor(null);
        if (e instanceof PermissionDeniedError) {
          toast.danger("You can't message this user.");
        } else {
          toast.danger("Couldn't start chat. Try again.");
        }
      }
    },
    [creatingFor, onClose, router, toast]
  );

  return (
    <div
      className={`fixed inset-0 z-[58] bg-[var(--page-bg)] flex flex-col ${
        closing ? "peja-slide-out-to-right" : "peja-slide-in-from-right"
      }`}
    >
      {/* Header: respects the device's safe-area top inset (notch /
          status bar) so the back button and search input never get
          clipped on iOS or Capacitor builds. Same convention used by
          the main app header (glass-header in globals.css). */}
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
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-400 pointer-events-none" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find someone to message"
              className="w-full h-10 rounded-xl bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] pl-9 pr-9 text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-[var(--chat-input-hover)] flex items-center justify-center"
                aria-label="Clear search"
              >
                <X className="w-3 h-3 text-dark-200" />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {people === null ? (
          <p className="text-sm text-dark-400 text-center py-12">Loading…</p>
        ) : loadError ? (
          <div className="text-center py-12 px-6">
            <p className="text-sm text-dark-200 mb-2">
              Couldn&rsquo;t load the user list.
            </p>
            <p className="text-[11px] text-dark-500 font-mono break-words">
              {loadError}
            </p>
            <p className="text-[11px] text-dark-500 mt-3">
              If this says &ldquo;function … does not exist&rdquo;, the
              MVP/VIP migrations haven&rsquo;t been applied yet.
            </p>
          </div>
        ) : people.length === 0 ? (
          <div className="text-center py-12 px-6">
            <p className="text-sm text-dark-300 mb-1">
              No one available to message right now.
            </p>
            <p className="text-[11px] text-dark-500">
              Messaging is reserved for VIP and MVP accounts. Ask an
              admin if you need access.
            </p>
          </div>
        ) : filtered && filtered.length === 0 ? (
          <p className="text-sm text-dark-400 text-center py-12">
            No matches for &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {(filtered ?? []).map((u) => {
              const busy = creatingFor === u.id;
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(u.id)}
                    disabled={!!creatingFor}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--chat-input-hover)] disabled:opacity-50 text-left transition-colors"
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
                    {busy && (
                      <span className="text-[11px] text-dark-400">Opening…</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
