"use client";

// Inline "incident card" rendered underneath a chat message whose
// body contains a peja.life/post/<uuid> link. Lazily fetches the post
// the first time we see it, caches the result in module scope so
// re-renders + repeat references in the same thread don't re-query.
//
// Tap → navigate to /post/<id> like everywhere else in the app.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";

interface PreviewPost {
  id: string;
  category: string | null;
  comment: string | null;
  address: string | null;
  created_at: string;
  is_sensitive: boolean | null;
  thumbnail_url: string | null;
  thumbnail_is_video: boolean;
}

// Strict match — full UUIDv4 is required when we actually need the
// post id to fetch the card. Used by the in-bubble preview card.
const INCIDENT_URL_REGEX =
  /https?:\/\/(?:www\.)?peja\.life\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// Loose match — fires on anything that looks like the start of an
// incident URL, even after server-side truncation cuts the UUID. The
// DB trigger that writes conversations.last_message_text caps it at
// 100 chars, so a forward of a long caption + URL ends up like
// "...https://peja.life/post/52c9f46c..." — the strict regex above
// would miss that. Use this in summary surfaces (chat list, search,
// push notifications) where we just need to know "this message is a
// shared incident", not which one.
const INCIDENT_URL_LOOSE_REGEX = /https?:\/\/(?:www\.)?peja\.life\/post\//i;

export function extractIncidentPostId(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(INCIDENT_URL_REGEX);
  return m ? m[1] : null;
}

export function messageMentionsIncident(text: string | null | undefined): boolean {
  if (!text) return false;
  return INCIDENT_URL_LOOSE_REGEX.test(text);
}

/**
 * Friendly summary of a chat message body for the conversation
 * list and for push notifications. The Forward-to-chat flow now
 * sends just the incident URL as the body, which would otherwise
 * render as a raw `https://peja.life/post/...` line in those
 * surfaces. We substitute "📢 Shared an incident" when the body
 * is JUST an incident URL, but keep any user-typed commentary
 * intact when it sits alongside the URL.
 *
 * Returns the original text if it doesn't match the incident URL
 * shape (or contains text in addition to the URL), so this is
 * safe to call on every last_message_text without specialising at
 * the call site.
 */
export function formatChatPreview(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  // Use the loose check — `last_message_text` is server-side
  // truncated to 100 chars, so a strict UUID match misses any
  // forward whose caption pushed the URL past the cutoff.
  if (messageMentionsIncident(text)) return "📢 Shared an incident";
  return text;
}

// Cache lives for the lifetime of the page. `null` means we already
// tried and the post is gone (or RLS denied) — don't retry on every
// re-render. `undefined` means not loaded yet.
const cache = new Map<string, PreviewPost | null>();
const inflight = new Map<string, Promise<PreviewPost | null>>();

async function loadPreview(postId: string): Promise<PreviewPost | null> {
  if (cache.has(postId)) return cache.get(postId) ?? null;
  const existing = inflight.get(postId);
  if (existing) return existing;
  const p = (async () => {
    const { data, error } = await supabase
      .from("posts")
      .select(
        `id, category, comment, address, created_at, is_sensitive,
         post_media (url, media_type, thumbnail_url)`
      )
      .eq("id", postId)
      .maybeSingle();
    if (error || !data) {
      cache.set(postId, null);
      return null;
    }
    const firstMedia = Array.isArray((data as any).post_media)
      ? (data as any).post_media[0]
      : null;
    const isVideo = firstMedia?.media_type === "video";
    const thumb = firstMedia
      ? isVideo
        ? firstMedia.thumbnail_url || null
        : firstMedia.url
      : null;
    const result: PreviewPost = {
      id: (data as any).id,
      category: (data as any).category ?? null,
      comment: (data as any).comment ?? null,
      address: (data as any).address ?? null,
      created_at: (data as any).created_at,
      is_sensitive: (data as any).is_sensitive ?? null,
      thumbnail_url: thumb,
      thumbnail_is_video: !!isVideo,
    };
    cache.set(postId, result);
    return result;
  })();
  inflight.set(postId, p);
  try {
    return await p;
  } finally {
    inflight.delete(postId);
  }
}

/**
 * Tiny text-only snippet of a referenced incident — used by search
 * surfaces to give context next to the "📢 Shared an incident"
 * summary line. Pulls from the same module-level cache the bigger
 * preview card uses, so opening a thread that already rendered the
 * card means the snippet shows up instantly.
 */
export function IncidentDescriptionSnippet({ postId }: { postId: string }) {
  const [post, setPost] = useState<PreviewPost | null | undefined>(
    cache.has(postId) ? cache.get(postId) ?? null : undefined
  );

  useEffect(() => {
    if (cache.has(postId)) {
      setPost(cache.get(postId) ?? null);
      return;
    }
    let cancelled = false;
    loadPreview(postId).then((r) => {
      if (!cancelled) setPost(r);
    });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (!post) return null;
  const category = CATEGORIES.find((c) => c.id === post.category);
  const desc = (post.comment || "").trim();
  if (!desc && !category) return null;
  return (
    <span className="block text-[11.5px] text-dark-400 line-clamp-1 mt-0.5">
      {category ? <span className="font-semibold">{category.name}: </span> : null}
      {desc || "(no description)"}
    </span>
  );
}

interface Props {
  postId: string;
  variant: "mine" | "theirs";
}

export function IncidentLinkPreview({ postId, variant }: Props) {
  const router = useRouter();
  const [post, setPost] = useState<PreviewPost | null | undefined>(
    cache.has(postId) ? cache.get(postId) ?? null : undefined
  );

  useEffect(() => {
    if (cache.has(postId)) {
      setPost(cache.get(postId) ?? null);
      return;
    }
    let cancelled = false;
    loadPreview(postId).then((r) => {
      if (!cancelled) setPost(r);
    });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  // Loading — minimal shimmer that reserves the SAME footprint the
  // loaded card will occupy. Without `w-[260px]` the bubble used to
  // collapse to the percentage-width child bars, producing a tiny
  // placeholder that snapped to full size when the post landed
  // (visible on cold-start scrollbacks).
  if (post === undefined) {
    return (
      <div
        className={`mt-2 w-[260px] max-w-full rounded-xl overflow-hidden border ${
          variant === "mine"
            ? "border-white/15 bg-white/5"
            : "border-[var(--chat-input-border)] bg-[var(--chat-input-bg)]"
        }`}
      >
        <div className="aspect-[16/9] w-full bg-[var(--chat-other-bg)] animate-pulse" />
        <div className="px-2.5 py-2 space-y-1.5">
          <div className="h-3 w-1/3 rounded bg-[var(--chat-other-bg)] animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-[var(--chat-other-bg)] animate-pulse" />
        </div>
      </div>
    );
  }

  // Post not found / RLS-denied — fall back to nothing extra. The
  // raw URL in the bubble text already serves as the click target.
  if (post === null) return null;

  const category = CATEGORIES.find((c) => c.id === post.category);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        router.push(`/post/${post.id}`);
      }}
      className={`mt-2 block w-[260px] max-w-full text-left rounded-xl overflow-hidden border transition-colors active:scale-[0.99] ${
        variant === "mine"
          ? "border-white/15 bg-white/5 hover:bg-white/10"
          : "border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] hover:bg-[var(--chat-input-hover)]"
      }`}
      aria-label="Open incident"
    >
      {post.thumbnail_url ? (
        <div className="relative aspect-[16/9] w-full bg-[var(--chat-other-bg)]">
          <img
            src={post.thumbnail_url}
            alt=""
            className={`w-full h-full object-cover ${
              post.is_sensitive ? "blur-lg" : ""
            }`}
          />
          {post.is_sensitive && (
            <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 text-[10px] font-semibold text-white">
              <AlertTriangle className="w-3 h-3" />
              Sensitive
            </span>
          )}
          {post.thumbnail_is_video && (
            <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-bold text-white">
              VIDEO
            </span>
          )}
        </div>
      ) : (
        <div
          className={`aspect-[16/9] w-full flex items-center justify-center ${
            variant === "mine"
              ? "bg-white/5"
              : "bg-[var(--chat-other-bg)]"
          }`}
        >
          <ImageIcon
            className={`w-6 h-6 ${
              variant === "mine" ? "text-white/40" : "text-dark-500"
            }`}
          />
        </div>
      )}
      <div className="px-2.5 py-2">
        {category && (
          <span
            className={`inline-block text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded-full mb-1 ${
              variant === "mine" ? "bg-white/15 text-white/90" : "bg-primary-500/15 text-primary-300"
            }`}
          >
            {category.name}
          </span>
        )}
        {post.comment && (
          <p
            className={`text-[12.5px] leading-snug line-clamp-2 ${
              variant === "mine" ? "text-white/90" : "text-dark-100"
            }`}
          >
            {post.comment}
          </p>
        )}
        <div
          className={`mt-1 flex items-center gap-1 text-[10.5px] ${
            variant === "mine" ? "text-white/65" : "text-dark-400"
          }`}
        >
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate flex-1">
            {post.address || "Unknown location"}
          </span>
          <span className="shrink-0">
            ·{" "}
            {formatDistanceToNow(new Date(post.created_at), {
              addSuffix: false,
            })}
          </span>
        </div>
      </div>
    </button>
  );
}
