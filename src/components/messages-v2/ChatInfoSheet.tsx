"use client";

// Fullscreen chat-info overlay opened when the user taps the name in
// the thread header (or the kebab → "View profile"). Layout:
//
//   [Header pill — back + "Chat info"]
//   ┌───────────────────────────────────┐
//   │   [large avatar]                  │
//   │   User Name                       │
//   │   (status, e.g. "online")         │
//   ├───────────────────────────────────┤
//   │   Media  Voice notes  Files  Links│  ← horizontal scroll of section headers
//   │   [grid of thumbs / list]         │
//   ├───────────────────────────────────┤
//   │   🔇 Mute  /  Unmute              │
//   │   🚫 Block / Unblock              │
//   │   🧽 Clear chat                    │
//   │   🗑  Delete chat                  │
//   └───────────────────────────────────┘
//
// Action buttons sit at the bottom. Block + Delete chat get a
// confirmation step via the existing useConfirm context so a stray
// tap can't destroy state.

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BellOff,
  Bell,
  Ban,
  Eraser,
  Trash2,
  User,
  Users,
  FileText,
  Link as LinkIcon,
  AlertTriangle,
  Flag,
  Camera,
  Pencil,
  UserPlus,
  Crown,
  Star,
  AtSign,
  LogOut,
  X as XIcon,
} from "lucide-react";
import {
  fetchSharedMedia,
  fetchSharedLinks,
  fetchSharedIncidents,
  type SharedMediaBuckets,
  type SharedLink,
  type SharedIncident,
  type NotificationMode,
} from "@/features/chat/api";
import type { ChatMessageMedia, GroupParticipant } from "@/features/chat/types";
import { AudioBubble } from "./AudioBubble";
import { IncidentLinkPreview } from "./IncidentLinkPreview";

interface Props {
  conversationId: string;
  currentUserId: string;
  otherUserName: string | null;
  otherUserAvatarUrl: string | null;
  statusLine: string | null;
  isMuted: boolean;
  isBlocked: boolean;
  onClose: () => void;
  onAvatarTap: () => void;
  onToggleMute: () => void;
  onToggleBlock: () => void;
  onClearChat: () => void;
  onDeleteChat: () => void;
  onReport: () => void;
  onOpenMedia: (
    items: ChatMessageMedia[],
    index: number,
    kind: "visual" | "audio" | "document"
  ) => void;
  onOpenLink: (url: string) => void;

  // Group props — all optional so DM call sites stay unchanged.
  isGroup?: boolean;
  myRole?: "owner" | "member";
  memberCount?: number;
  participants?: GroupParticipant[] | null;
  notificationMode?: NotificationMode;
  onSetNotificationMode?: (mode: NotificationMode) => void;
  onLeaveGroup?: () => void;
  onDeleteGroup?: () => void;
  onRenameGroup?: (newName: string) => Promise<void>;
  onChangeGroupAvatar?: (file: File) => Promise<void>;
  onAddMember?: () => void;
  onRemoveMember?: (userId: string) => void;
  onReportMessage?: (messageId: string) => void;
}

type TabKey = "members" | "media" | "audio" | "documents" | "links" | "incidents";

const DM_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "media", label: "Media" },
  { key: "audio", label: "Voice notes" },
  { key: "documents", label: "Files" },
  { key: "links", label: "Links" },
  { key: "incidents", label: "Incidents" },
];

const GROUP_TABS: Array<{ key: TabKey; label: string }> = [
  { key: "members", label: "Members" },
  { key: "media", label: "Media" },
  { key: "audio", label: "Voice notes" },
  { key: "documents", label: "Files" },
  { key: "links", label: "Links" },
  { key: "incidents", label: "Incidents" },
];

export function ChatInfoSheet({
  conversationId,
  currentUserId,
  otherUserName,
  otherUserAvatarUrl,
  statusLine,
  isMuted,
  isBlocked,
  onClose,
  onAvatarTap,
  onToggleMute,
  onToggleBlock,
  onClearChat,
  onDeleteChat,
  onReport,
  onOpenMedia,
  onOpenLink,
  isGroup,
  myRole,
  memberCount,
  participants,
  notificationMode,
  onSetNotificationMode,
  onLeaveGroup,
  onDeleteGroup,
  onRenameGroup,
  onChangeGroupAvatar,
  onAddMember,
  onRemoveMember,
}: Props) {
  const [media, setMedia] = useState<SharedMediaBuckets | null>(null);
  const [links, setLinks] = useState<SharedLink[]>([]);
  const [incidents, setIncidents] = useState<SharedIncident[]>([]);
  const [tab, setTab] = useState<TabKey>(isGroup ? "members" : "media");
  const [loading, setLoading] = useState(true);
  // Inline name editor — only used in groups where the owner can
  // rename. Toggled by the pencil-icon button next to the name in
  // the hero. Saving fires the parent's onRenameGroup callback.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const TABS = isGroup ? GROUP_TABS : DM_TABS;
  const isOwner = isGroup && myRole === "owner";
  // When the user dismisses the sheet we don't unmount immediately —
  // we flip `closing` first so the slide-out-to-right animation can
  // play, then call the parent's onClose when the animation lands.
  // Falls back to a timeout in case animationend doesn't fire (some
  // WebView builds drop the event when the element is mid-transform).
  const [closing, setClosing] = useState(false);
  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose(), 220);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchSharedMedia(conversationId, currentUserId),
      fetchSharedLinks(conversationId, currentUserId),
      fetchSharedIncidents(conversationId, currentUserId),
    ])
      .then(([m, l, inc]) => {
        if (cancelled) return;
        setMedia(m);
        setLinks(l);
        setIncidents(inc);
      })
      .catch(() => {
        if (cancelled) return;
        setMedia({ images: [], videos: [], audios: [], documents: [] });
        setLinks([]);
        setIncidents([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, currentUserId]);

  const visuals = media ? [...media.images, ...media.videos] : [];
  const audios = media?.audios ?? [];
  const documents = media?.documents ?? [];

  // Three-layer layout for predictable sticky behaviour:
  //   • Outer (fixed inset-0, NO overflow): just establishes the
  //     viewport-sized box.
  //   • Static header (shrink-0): always visible at the top.
  //   • Scrollable middle (flex-1 overflow-y-auto): owns the actual
  //     scrollbar. Hero scrolls inside it; the tabs are sticky to the
  //     TOP OF THE MIDDLE container (top-0 inside middle = right under
  //     the header), so they pin reliably as the user scrolls through
  //     a long media grid.
  //   • Static actions footer (shrink-0): always visible at the
  //     bottom — the four destructive actions are the whole point of
  //     this sheet, no point hiding them behind a scroll.
  //
  // The previous layout put `overflow-y-auto` on the outer and tried
  // to anchor sticky tabs with `top-14`. That worked while loading
  // (content short → no scroll → everything visible), but once the
  // media grid pushed total height past the viewport, the tabs
  // scrolled out and `top-14` couldn't pin them because the sticky
  // context was the outer flex container, which behaves oddly with
  // multi-sticky children that have different offsets.
  return (
    <div
      className={`fixed inset-0 z-[55] bg-[var(--page-bg)] flex flex-col ${
        closing ? "peja-slide-out-to-right" : "peja-slide-in-from-right"
      }`}
    >
      <header className="shrink-0 flex items-center gap-3 px-4 h-14 border-b border-[var(--chat-input-border)]">
        <button
          type="button"
          onClick={handleClose}
          className="w-9 h-9 rounded-full bg-[var(--chat-input-bg)] flex items-center justify-center"
          aria-label="Close"
        >
          <ArrowLeft className="w-5 h-5 text-dark-200" />
        </button>
        <span className="text-base font-semibold text-dark-100">Chat info</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Hero — DM: tap avatar to preview; Group + owner: tap to
            change the photo; Group + member: read-only. Name + an
            inline rename pencil sit beside it for the owner. */}
        <section className="flex flex-col items-center gap-3 py-6 px-4">
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (isOwner) {
                  avatarInputRef.current?.click();
                } else {
                  onAvatarTap();
                }
              }}
              className="w-28 h-28 rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center active:opacity-80"
              aria-label={
                isOwner ? "Change group photo" : "View profile picture"
              }
            >
              {otherUserAvatarUrl ? (
                <img
                  src={otherUserAvatarUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : isGroup ? (
                <Users className="w-14 h-14 text-dark-400" />
              ) : (
                <User className="w-14 h-14 text-dark-400" />
              )}
            </button>
            {isOwner && (
              <span
                className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-primary-600 text-white flex items-center justify-center border-2 border-[var(--page-bg)]"
                aria-hidden
              >
                {uploadingAvatar ? (
                  <span className="block w-3.5 h-3.5 rounded-full border-2 border-white/60 border-t-white animate-spin" />
                ) : (
                  <Camera className="w-4 h-4" />
                )}
              </span>
            )}
          </div>
          {isOwner && (
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f || !onChangeGroupAvatar) return;
                if (!f.type.startsWith("image/") || f.size > 5 * 1024 * 1024) {
                  return;
                }
                setUploadingAvatar(true);
                try {
                  await onChangeGroupAvatar(f);
                } finally {
                  setUploadingAvatar(false);
                }
              }}
            />
          )}

          <div className="text-center w-full">
            {editingName ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const trimmed = nameDraft.trim();
                  if (!trimmed || !onRenameGroup) return;
                  setSavingName(true);
                  try {
                    await onRenameGroup(trimmed);
                    setEditingName(false);
                  } finally {
                    setSavingName(false);
                  }
                }}
                className="flex items-center gap-2 max-w-sm mx-auto"
              >
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={64}
                  className="flex-1 h-9 px-2 rounded-lg bg-[var(--chat-input-bg)] border border-[var(--chat-input-border)] text-sm text-dark-100 focus:outline-none focus:border-primary-500/40"
                />
                <button
                  type="submit"
                  disabled={savingName || !nameDraft.trim()}
                  className="h-9 px-3 rounded-lg bg-primary-600 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="h-9 w-9 rounded-lg bg-[var(--chat-input-bg)] flex items-center justify-center"
                  aria-label="Cancel"
                >
                  <XIcon className="w-4 h-4 text-dark-300" />
                </button>
              </form>
            ) : (
              <div className="inline-flex items-center gap-1.5">
                <p className="text-lg font-semibold text-dark-100">
                  {otherUserName || (isGroup ? "Group" : "Chat")}
                </p>
                {isOwner && onRenameGroup && (
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(otherUserName || "");
                      setEditingName(true);
                    }}
                    className="p-1 rounded-md hover:bg-[var(--chat-input-hover)]"
                    aria-label="Rename group"
                  >
                    <Pencil className="w-3.5 h-3.5 text-dark-400" />
                  </button>
                )}
              </div>
            )}
            {isGroup ? (
              <p className="text-xs text-dark-400 mt-0.5">
                {(memberCount ?? 0).toLocaleString()} member
                {(memberCount ?? 0) === 1 ? "" : "s"}
              </p>
            ) : (
              statusLine && (
                <p className="text-xs text-dark-400">{statusLine}</p>
              )
            )}
          </div>
        </section>

        {/* Tabs — sticky to the top of THIS scrolling middle area
            (top-0 inside the middle), so they pin under the static
            header as the user scrolls. The bg is opaque so the
            scrolling hero / content doesn't show through. */}
        <nav className="sticky top-0 z-10 bg-[var(--page-bg)] px-4 flex gap-2 overflow-x-auto border-b border-[var(--chat-input-border)]">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`shrink-0 py-2.5 px-1 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "text-primary-400 border-b-2 border-primary-500"
                  : "text-dark-400"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="px-4 py-4">
          {loading ? (
            <p className="text-sm text-dark-400 text-center py-8">Loading…</p>
          ) : (
            <>
              {tab === "media" && (
                <MediaTab
                  items={visuals}
                  onOpen={(idx) => onOpenMedia(visuals, idx, "visual")}
                />
              )}
              {tab === "audio" && <AudioTab items={audios} />}
              {tab === "documents" && (
                <DocumentsTab
                  items={documents}
                  onOpen={(idx) => onOpenMedia(documents, idx, "document")}
                />
              )}
              {tab === "links" && (
                <LinksTab items={links} onOpen={onOpenLink} />
              )}
              {tab === "incidents" && <IncidentsTab items={incidents} />}
              {tab === "members" && isGroup && (
                <MembersTab
                  participants={participants ?? null}
                  currentUserId={currentUserId}
                  canManage={!!isOwner}
                  onAddMember={onAddMember}
                  onRemoveMember={onRemoveMember}
                />
              )}
            </>
          )}
        </div>
      </div>

      <section className="shrink-0 px-4 py-3 border-t border-[var(--chat-input-border)] space-y-1 bg-[var(--page-bg)]">
        {/* In groups the "muted" visual state is driven by
            notification_mode (the 3-way 'all' / 'mentions' / 'muted'
            choice) — not by is_muted, which is a legacy boolean that
            ALSO flips on when the user picks Mentions-only. Driving
            the icon AND label off the same source of truth means
            tapping Only-mentions no longer makes the Mute row swap
            its icon/label as if you'd muted everything. */}
        <ActionRow
          icon={
            (isGroup ? notificationMode === "muted" : isMuted) ? (
              <Bell className="w-5 h-5" />
            ) : (
              <BellOff className="w-5 h-5" />
            )
          }
          label={
            isGroup
              ? notificationMode === "muted"
                ? "Unmute notifications"
                : "Mute notifications"
              : isMuted
                ? "Unmute notifications"
                : "Mute notifications"
          }
          onClick={onToggleMute}
        />
        {/* Groups get a "mentions only" middle option. Mute and
            Mentions-only are mutually exclusive so the active state
            is read from notification_mode, not is_muted. */}
        {isGroup && onSetNotificationMode && (
          <ActionRow
            icon={<AtSign className="w-5 h-5" />}
            label={
              notificationMode === "mentions"
                ? "Only mentions: on"
                : "Only notify on mentions"
            }
            onClick={() =>
              onSetNotificationMode(
                notificationMode === "mentions" ? "all" : "mentions"
              )
            }
          />
        )}
        {!isGroup && (
          <ActionRow
            icon={<Ban className="w-5 h-5" />}
            label={isBlocked ? "Unblock user" : "Block user"}
            onClick={onToggleBlock}
            danger
          />
        )}
        <ActionRow
          icon={<Eraser className="w-5 h-5" />}
          label="Clear chat"
          onClick={onClearChat}
        />
        {!isGroup && (
          <ActionRow
            icon={<Flag className="w-5 h-5" />}
            label="Report user"
            onClick={onReport}
            danger
          />
        )}
        {isGroup && !isOwner && onLeaveGroup && (
          <ActionRow
            icon={<LogOut className="w-5 h-5" />}
            label="Leave group"
            onClick={onLeaveGroup}
            danger
          />
        )}
        {isGroup && isOwner ? (
          <ActionRow
            icon={<Trash2 className="w-5 h-5" />}
            label="Delete group"
            onClick={onDeleteGroup || onDeleteChat}
            danger
          />
        ) : (
          !isGroup && (
            <ActionRow
              icon={<Trash2 className="w-5 h-5" />}
              label="Delete chat"
              onClick={onDeleteChat}
              danger
            />
          )
        )}
      </section>
    </div>
  );
}

interface ActionRowProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function ActionRow({ icon, label, onClick, danger }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-[var(--chat-input-hover)] active:bg-[var(--chat-input-hover)] transition-colors text-left ${
        danger ? "text-red-400" : "text-dark-100"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function MediaTab({
  items,
  onOpen,
}: {
  items: ChatMessageMedia[];
  onOpen: (index: number) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-dark-400 text-center py-8">
        No photos or videos shared yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-1">
      {items.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onOpen(i)}
          className="relative aspect-square rounded-md overflow-hidden bg-[var(--chat-other-bg)]"
        >
          {m.media_type === "video" ? (
            <video
              src={m.url}
              poster={m.thumbnail_url || undefined}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <img
              src={m.url}
              alt=""
              className="w-full h-full object-cover"
            />
          )}
          {m.media_type === "video" && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white text-lg">
              ▶
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function AudioTab({ items }: { items: ChatMessageMedia[] }) {
  // Reuse the same AudioBubble that renders inline in the chat
  // thread. Tap morphs the play button into pause and the waveform
  // scrubber tracks playback — no DocumentViewer detour, no external
  // tab. We wrap each one in a card-style row that matches the
  // "Files" / "Links" rows visually so the tabs share a consistent
  // list aesthetic. Variant "theirs" picks colours that read on the
  // sheet's plain page background (not on a coloured chat bubble).
  if (items.length === 0) {
    return (
      <p className="text-sm text-dark-400 text-center py-8">
        No voice notes shared yet.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {items.map((m) => (
        <li
          key={m.id}
          className="rounded-xl bg-[var(--chat-other-bg)] px-3 py-2"
        >
          <AudioBubble url={m.url} variant="theirs" />
        </li>
      ))}
    </ul>
  );
}

function DocumentsTab({
  items,
  onOpen,
}: {
  items: ChatMessageMedia[];
  onOpen: (index: number) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-dark-400 text-center py-8">
        No files shared yet.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {items.map((m, i) => (
        <li key={m.id}>
          <button
            type="button"
            onClick={() => onOpen(i)}
            className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[var(--chat-input-hover)] text-left"
          >
            <span className="shrink-0 w-10 h-10 rounded-lg bg-[var(--chat-control-other-bg)] text-dark-100 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm truncate text-dark-100">
                {m.file_name || "File"}
              </span>
              <span className="block text-[11px] text-dark-400 tabular-nums">
                {formatBytes(m.file_size)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function LinksTab({
  items,
  onOpen,
}: {
  items: SharedLink[];
  onOpen: (url: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-dark-400 text-center py-8">
        No links shared yet.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {items.map((l, i) => (
        <li key={`${l.message_id}-${i}`}>
          <button
            type="button"
            onClick={() => onOpen(l.url)}
            className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[var(--chat-input-hover)] text-left"
          >
            <span className="shrink-0 w-10 h-10 rounded-lg bg-[var(--chat-control-other-bg)] text-dark-100 flex items-center justify-center">
              <LinkIcon className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm truncate text-primary-300">
                {l.url}
              </span>
              <span className="block text-[11px] text-dark-400 truncate">
                {l.context}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function IncidentsTab({ items }: { items: SharedIncident[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <AlertTriangle className="w-8 h-8 text-dark-400" />
        <p className="text-sm text-dark-400">
          Incidents shared in this chat will appear here.
        </p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-1">
      {items.map((it) => (
        <li key={it.message_id}>
          <IncidentLinkPreview postId={it.post_id} variant="theirs" />
        </li>
      ))}
    </ul>
  );
}

function MembersTab({
  participants,
  currentUserId,
  canManage,
  onAddMember,
  onRemoveMember,
}: {
  participants: GroupParticipant[] | null;
  currentUserId: string;
  canManage: boolean;
  onAddMember?: () => void;
  onRemoveMember?: (userId: string) => void;
}) {
  if (participants === null) {
    return (
      <p className="text-sm text-dark-400 text-center py-8">Loading…</p>
    );
  }
  return (
    <div className="space-y-1 pb-2">
      {canManage && onAddMember && (
        <button
          type="button"
          onClick={onAddMember}
          className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[var(--chat-input-hover)] text-left text-primary-300"
        >
          <span className="shrink-0 w-10 h-10 rounded-full bg-primary-500/15 flex items-center justify-center">
            <UserPlus className="w-5 h-5" />
          </span>
          <span className="text-sm font-medium">Add members</span>
        </button>
      )}
      {participants.map((p) => {
        const isMe = p.user_id === currentUserId;
        return (
          <div
            key={p.user_id}
            className="flex items-center gap-3 px-2 py-2.5 rounded-xl"
          >
            <span className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center">
              {p.avatar_url ? (
                <img
                  src={p.avatar_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-5 h-5 text-dark-400" />
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-dark-100 truncate">
                {p.full_name || "User"}
                {isMe && (
                  <span className="ml-1 text-[11px] text-dark-400">(You)</span>
                )}
              </span>
              <span className="inline-flex items-center gap-1 mt-0.5">
                {p.role === "owner" && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full peja-badge-owner">
                    Owner
                  </span>
                )}
                {p.is_mvp && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full peja-badge-mvp">
                    <Star className="w-2.5 h-2.5" />
                    MVP
                  </span>
                )}
                {p.is_vip && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full peja-badge-vip">
                    <Crown className="w-2.5 h-2.5" />
                    VIP
                  </span>
                )}
              </span>
            </span>
            {canManage && !isMe && p.role !== "owner" && onRemoveMember && (
              <button
                type="button"
                onClick={() => onRemoveMember(p.user_id)}
                className="shrink-0 w-8 h-8 rounded-full bg-[var(--chat-input-bg)] hover:bg-red-500/20 hover:text-red-400 flex items-center justify-center text-dark-300 transition-colors"
                aria-label={`Remove ${p.full_name || "member"}`}
              >
                <XIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
