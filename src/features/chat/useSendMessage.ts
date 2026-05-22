"use client";

// Send hook for v2 chat. UUID-based optimistic + offline outbox +
// retry-on-tap, as in Phases 1/2. Phase 3a/3b added images and videos.
//
// Phase 3 polish (this file's most recent rewrite):
//
//   1. `processAttachment` (chatMedia.ts) runs FIRST. It validates size
//      caps, HEIC-converts iPhone photos, image-compresses, and routes
//      videos through Cloudinary's transcoding upload. The result tells
//      us whether to upload the bytes to Supabase Storage (image,
//      document, small video) or skip straight to the message_media
//      insert with a pre-hosted URL (Cloudinary-compressed video).
//
//   2. Pipeline progress is mirrored into the store under
//      `uploadProgressById[messageId]` so the bubble's circular ring
//      can render the percentage live.
//
//   3. All blob: URLs are made before the pipeline runs so the
//      optimistic bubble shows immediately, even though compression /
//      Cloudinary upload then runs for several seconds.

import { useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "./store";
import {
  sendTextMessage,
  sendMediaMessage,
  uploadMediaToStorage,
  fetchGroupParticipantsForNotify,
} from "./api";
import { addToOutbox, patchOutboxItem, removeFromOutbox } from "./outbox";
import { putBlob, removeBlobsForMessage } from "./mediaBlobs";
import { processAttachment, type ProcessedAttachment } from "./chatMedia";
import { notifyDMMessage } from "@/lib/notifications";
import { isUserViewingConversation } from "./presence";
import { formatChatPreview } from "@/components/messages-v2/IncidentLinkPreview";
import type {
  ChatMessage,
  ChatMessageMedia,
  OutboxMediaAttachment,
} from "./types";

// Module-level registry of in-flight send AbortControllers, keyed by
// message id. useSendMessage registers one per send before kicking off
// the upload; cancelInflightSend() (exported below) looks it up and
// aborts. Outside-React state on purpose — the controller needs to
// outlive the component the user navigates away from, and React state
// would re-render too eagerly on every progress tick.
const inflightControllers = new Map<string, AbortController>();

export function useSendMessage() {
  const { user } = useAuth();

  const send = useCallback(
    async (
      conversationId: string,
      content: string,
      attachments?: File[],
      // Stage-2 reply support: pass the parent message we're replying
      // to (already in the store) so the optimistic bubble can render
      // the quoted-reference block immediately, and so the insert
      // carries reply_to_id.
      replyTo?: ChatMessage["reply_to"] | null
    ) => {
      const trimmed = content.trim();
      const files = (attachments ?? []).filter((f) => f.size > 0);
      if (!user?.id) return;
      if (!trimmed && files.length === 0) return;

      const messageId = newUuid();
      const store = useChatStore.getState();

      // Optimistic timestamp = max(device clock, last-known-message + 1ms).
      const existingMessages = store.threadsByConversation[conversationId]?.messages || [];
      const lastTime = existingMessages.length
        ? new Date(existingMessages[existingMessages.length - 1].created_at).getTime()
        : 0;
      const optimisticTime = new Date(Math.max(Date.now(), lastTime + 1)).toISOString();

      const isMedia = files.length > 0;

      // Read dimensions + create blob URLs for instant optimistic
      // bubbles. The pipeline (compression / Cloudinary) runs after.
      const prepared = await Promise.all(
        files.map(async (file) => {
          const attachmentId = newUuid();
          const type = mediaTypeFor(file);
          if (type === "image") {
            const dims = await readImageDimensions(file);
            return { file, attachmentId, type, ...dims };
          }
          if (type === "video") {
            const dims = await readVideoDimensions(file);
            return { file, attachmentId, type, ...dims };
          }
          return {
            file,
            attachmentId,
            type,
            blobUrl: URL.createObjectURL(file),
            width: undefined as number | undefined,
            height: undefined as number | undefined,
          };
        })
      );

      const optimisticMedia: ChatMessageMedia[] = [];
      const outboxMedia: OutboxMediaAttachment[] = [];
      for (const p of prepared) {
        optimisticMedia.push({
          id: p.attachmentId,
          message_id: messageId,
          url: p.blobUrl,
          media_type: p.type,
          file_name: p.file.name,
          file_size: p.file.size,
          mime_type: p.file.type || guessMime(p.file.name),
          thumbnail_url: null,
          created_at: optimisticTime,
          optimistic: true,
          width: p.width,
          height: p.height,
        });
        outboxMedia.push({
          attachment_id: p.attachmentId,
          media_type: p.type,
          file_name: p.file.name,
          mime_type: p.file.type || guessMime(p.file.name),
          size: p.file.size,
        });
      }

      // 1. Optimistic add.
      const optimisticMessage: ChatMessage = {
        id: messageId,
        conversation_id: conversationId,
        sender_id: user.id,
        content: trimmed || null,
        content_type: isMedia ? "media" : "text",
        created_at: optimisticTime,
        edited_at: null,
        is_deleted: false,
        reply_to_id: replyTo?.id ?? null,
        reply_to: replyTo ?? null,
        delivery_status: "pending",
        media: isMedia ? optimisticMedia : undefined,
      };
      store.upsertMessage(conversationId, optimisticMessage);

      // Initial progress entry so the ring renders immediately rather
      // than waiting for the first pipeline tick.
      if (isMedia) {
        store.setUploadProgress(messageId, {
          fraction: 0,
          label: "Preparing…",
        });
      }

      // Local-only preview bump for the conversation list. We pick
      // the same type-specific string the DB trigger writes
      // (peja_message_preview) so the list shows the correct icon
      // INSTANTLY rather than flashing "📷 Photo" for a voice note
      // before the realtime echo lands a fraction of a second later.
      // Fallback to a generic string if we somehow have no prepared
      // attachments.
      const optimisticPreview = isMedia
        ? previewForOptimisticMedia(prepared[0]?.type)
        : trimmed.slice(0, 100);
      store.bumpConversation(conversationId, {
        last_message_text: optimisticPreview,
        last_message_at: optimisticTime,
        last_message_sender_id: user.id,
      });

      // 2. Persist outbox + IDB blobs BEFORE attempting the network
      //    calls. A crash / reload between here and confirm still has
      //    the message durable.
      addToOutbox(user.id, {
        id: messageId,
        conversation_id: conversationId,
        sender_id: user.id,
        content: trimmed,
        created_at: optimisticTime,
        attempts: 0,
        last_error: null,
        media: isMedia ? outboxMedia : undefined,
      });
      if (isMedia) {
        await Promise.all(
          prepared.map((p) =>
            putBlob(messageId, p.attachmentId, p.file).catch((e) =>
              console.warn("[chat-v2] putBlob failed", e)
            )
          )
        );
      }

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        console.log("[chat-v2] offline — message queued", { messageId, isMedia });
        return;
      }

      // 3. Run the upload pipeline. Register an AbortController so
      //    cancelInflightSend(messageId) can interrupt a long upload
      //    mid-flight (e.g. user tapped X on the progress ring).
      const controller = new AbortController();
      inflightControllers.set(messageId, controller);
      console.log("[chat-v2] sending message", { id: messageId, isMedia });
      try {
        let confirmed: ChatMessage;
        if (isMedia) {
          confirmed = await uploadAndSendMedia({
            id: messageId,
            conversationId,
            senderId: user.id,
            caption: trimmed,
            files: prepared.map((p) => p.file),
            outboxMedia,
            outboxUserId: user.id,
            onProgress: (frac, label) =>
              store.setUploadProgress(messageId, { fraction: frac, label }),
            abortSignal: controller.signal,
            replyToId: replyTo?.id ?? null,
          });
        } else {
          confirmed = await sendTextMessage({
            id: messageId,
            conversation_id: conversationId,
            sender_id: user.id,
            content: trimmed,
            reply_to_id: replyTo?.id ?? null,
          });
        }
        console.log("[chat-v2] send confirmed", {
          id: messageId,
          created_at: confirmed.created_at,
          media_count: confirmed.media?.length ?? 0,
        });

        store.patchMessage(conversationId, messageId, {
          delivery_status: "sent",
          created_at: confirmed.created_at,
          ...(confirmed.media && confirmed.media.length > 0
            ? { media: confirmed.media }
            : {}),
        });
        // Fire-and-forget push notifications. For DMs we ping the one
        // other participant; for groups we fan out to every member.
        // Per-recipient gates:
        //   - skip if the recipient is currently presence-viewing
        //     this conversation (their app is open on the chat — the
        //     realtime echo will surface the message anyway)
        //   - skip if their notification_mode is 'muted'
        //   - if 'mentions', deliver only when the body actually
        //     @-tags them (or @everyone). Mention matching is
        //     client-side and best-effort; mismatches fail open.
        const convSummary = store.conversationsById[conversationId];
        const preview = previewForNotification(trimmed, confirmed);
        const senderName = user.full_name || "Someone";
        // High-signal log so we can confirm the notify decision when
        // a recipient says "I didn't get a ping". Logs the routing
        // path (group vs DM), the convSummary's is_group flag, and
        // the resolved other_user_id (DM) — enough to tell from the
        // sender's console why the fan-out went the way it did.
        console.log("[chat-v2] notify routing", {
          conversationId,
          is_group: !!convSummary?.is_group,
          has_summary: !!convSummary,
          other_user_id: convSummary?.other_user_id || null,
          preview,
        });
        if (convSummary?.is_group) {
          // Fan-out: pull the group's participant ids (minus self),
          // then dispatch notifyDMMessage per recipient that passes
          // the per-mode gate. Import is static (top-of-file) so the
          // first call doesn't pay a module-fetch tax. Each notify
          // fires in parallel so a slow recipient doesn't block the
          // others.
          (async () => {
            try {
              const recipients = await fetchGroupParticipantsForNotify(
                conversationId,
                user.id
              );
              console.log(
                "[chat-v2] group push fan-out",
                conversationId,
                "recipients:",
                recipients.length
              );
              const targets = recipients.filter((r) => {
                if (isUserViewingConversation(r.user_id, conversationId)) return false;
                if (r.notification_mode === "muted") return false;
                if (r.notification_mode === "mentions") {
                  return doesMessageMentionRecipient(trimmed, r);
                }
                return true;
              });
              await Promise.all(
                targets.map((r) =>
                  notifyDMMessage(
                    r.user_id,
                    senderName,
                    preview,
                    conversationId
                  )
                    .then((ok) => {
                      console.log(
                        "[chat-v2] notify",
                        r.user_id,
                        "ok=",
                        ok
                      );
                    })
                    .catch((err) => {
                      console.warn(
                        "[chat-v2] notifyDMMessage failed for",
                        r.user_id,
                        err
                      );
                    })
                )
              );
            } catch (err) {
              console.warn("[chat-v2] group push fan-out failed", err);
            }
          })();
        } else {
          const recipientId = convSummary?.other_user_id;
          if (
            recipientId &&
            !isUserViewingConversation(recipientId, conversationId)
          ) {
            notifyDMMessage(
              recipientId,
              senderName,
              preview,
              conversationId
            ).catch(() => {});
          }
        }
        if (optimisticMessage.media) {
          for (const m of optimisticMessage.media) {
            try { URL.revokeObjectURL(m.url); } catch {}
          }
        }
        removeFromOutbox(user.id, messageId);
        store.clearUploadProgress(messageId);
        if (isMedia) {
          removeBlobsForMessage(messageId).catch(() => {});
        }
      } catch (err) {
        // If this errored because we explicitly cancelled, the
        // cancellation handler has already removed the message from
        // store/outbox/IDB. Don't mark as "failed" — there's no bubble
        // to update and no reason to show a toast.
        if (controller.signal.aborted) {
          console.log("[chat-v2] send aborted by user", { id: messageId });
          return;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[chat-v2] send failed", err);
        patchOutboxItem(user.id, messageId, {
          attempts: 1,
          last_error: errMsg,
        });
        store.patchMessage(conversationId, messageId, {
          delivery_status: "failed",
        });
        store.clearUploadProgress(messageId);
        throw err;
      } finally {
        inflightControllers.delete(messageId);
      }
    },
    [user?.id]
  );

  return send;
}

// =====================================================
// Helpers
// =====================================================

// Optimistic conversation-list preview for media messages. Mirrors
// the strings the DB-side peja_message_preview() function writes
// after the trigger fires, so the local list update + the realtime
// echo show the same icon and don't flicker between values.
function previewForOptimisticMedia(
  type: "image" | "video" | "audio" | "document" | undefined
): string {
  switch (type) {
    case "image":
      return "📷 Photo";
    case "video":
      return "🎥 Video";
    case "audio":
      return "🎙 Voice note";
    case "document":
      return "📎 File";
    default:
      return "Sent an attachment";
  }
}

// Short notification preview for the v2 sender path. Mirrors v1's
// emoji-prefixed previews so the receiver's push notification reads
// naturally: "Alice: 📷 Photo", "Alice: 🎙 Voice note", etc.
function previewForNotification(
  trimmed: string,
  confirmed: ChatMessage
): string {
  if (confirmed.media && confirmed.media.length > 0) {
    const first = confirmed.media[0];
    switch (first.media_type) {
      case "image":
        return trimmed ? `📷 ${trimmed}` : "📷 Photo";
      case "video":
        return trimmed ? `🎥 ${trimmed}` : "🎥 Video";
      case "audio":
        return "🎙 Voice note";
      case "document":
        return `📎 ${first.file_name || "File"}`;
    }
  }
  // Substitute a friendly label when the body is just an incident
  // URL — otherwise the push notification reads as a raw link.
  const summarised = formatChatPreview(trimmed) || trimmed;
  return summarised.slice(0, 120) || "New message";
}

// Lightweight "is recipient mentioned in this body?" check. Used by
// the group push fan-out when the recipient's mode is 'mentions' so
// we only nudge them when they're actually @-tagged. Matches the
// composer's handle-insertion rules (first-name, alphanumeric +
// _ ' -) and treats "@everyone" / "@all" as a group-wide ping.
function doesMessageMentionRecipient(
  body: string,
  recipient: { full_name: string | null }
): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  if (/@everyone\b|@all\b/i.test(body)) return true;
  const name = (recipient.full_name || "").trim();
  if (!name) return false;
  const first = name.split(/\s+/)[0] || "";
  const handle = first.replace(/[^A-Za-z0-9_'-]/g, "");
  if (!handle) return false;
  const needle = `@${handle.toLowerCase()}`;
  // Word-boundary-ish: ensure a non-word char (or string end) follows
  // so "@John" doesn't match inside "@Johnny".
  const idx = lower.indexOf(needle);
  if (idx === -1) return false;
  const after = lower[idx + needle.length];
  return after === undefined || !/[a-z0-9_'-]/i.test(after);
}

function newUuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
}

function mediaTypeFor(file: File): "image" | "video" | "audio" | "document" {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  return "document";
}

// Reads natural pixel dimensions from an image File. Also returns the
// blob: URL it created during decode — reused for the optimistic media
// so we don't allocate two object URLs per file.
function readImageDimensions(
  file: File
): Promise<{ width: number; height: number; blobUrl: string }> {
  return new Promise((resolve) => {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || 800,
        height: img.naturalHeight || 600,
        blobUrl,
      });
    };
    img.onerror = () => {
      resolve({ width: 800, height: 600, blobUrl });
    };
    img.src = blobUrl;
  });
}

function readVideoDimensions(
  file: File
): Promise<{ width: number; height: number; blobUrl: string }> {
  return new Promise((resolve) => {
    const blobUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const done = (w: number, h: number) => {
      resolve({ width: w || 1280, height: h || 720, blobUrl });
    };
    video.onloadedmetadata = () => {
      done(video.videoWidth, video.videoHeight);
    };
    video.onerror = () => done(0, 0);
    video.src = blobUrl;
  });
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return "application/octet-stream";
}

/**
 * Runs the pre-upload pipeline (HEIC convert, compress, Cloudinary
 * transcode) per attachment, then either uploads bytes to Supabase
 * Storage OR uses the Cloudinary-hosted URL directly. Finally inserts
 * messages + message_media rows.
 *
 * Also used by useOutboxDrain to replay a queued media send — drain
 * reconstructs File objects from IDB blobs and calls back here.
 */
/**
 * Cancel an in-flight media send. Aborts the Cloudinary upload (and any
 * subsequent stages), then tears down the optimistic bubble, the outbox
 * entry, and the IDB blob(s). Safe to call even after a send finished —
 * a missing controller / message is a no-op.
 *
 * Note: Supabase Storage uploads don't currently honour the abort
 * signal (the SDK doesn't expose one), so images-in-flight to Storage
 * keep uploading in the background after cancel. The Storage object
 * gets orphaned; we'll add a periodic cleanup later. For videos, which
 * are the slow case the user actually wants to cancel, abort lands
 * promptly via the Cloudinary XHR.
 */
export function cancelInflightSend(messageId: string, opts?: {
  userId?: string;
  conversationId?: string;
}): void {
  const controller = inflightControllers.get(messageId);
  if (controller) controller.abort();
  inflightControllers.delete(messageId);

  const store = useChatStore.getState();
  const userId = opts?.userId ?? store.currentUserId;
  const conversationId = opts?.conversationId;

  // Tear down the optimistic bubble + outbox + IDB blobs. We do this
  // even if the controller wasn't found, in case the user cancelled
  // after the send already errored or completed and we're cleaning up.
  if (conversationId) {
    store.removeMessage(conversationId, messageId);
  } else {
    // Find the conversation the message belongs to so we can remove it.
    for (const [cid, thread] of Object.entries(store.threadsByConversation)) {
      if (thread?.messages.some((m) => m.id === messageId)) {
        store.removeMessage(cid, messageId);
        break;
      }
    }
  }
  store.clearUploadProgress(messageId);
  if (userId) removeFromOutbox(userId, messageId);
  removeBlobsForMessage(messageId).catch(() => {});
}

export async function uploadAndSendMedia(args: {
  id: string;
  conversationId: string;
  senderId: string;
  caption: string;
  files: File[];
  outboxMedia: OutboxMediaAttachment[];
  outboxUserId: string;
  onProgress?: (fraction: number, label?: string) => void;
  abortSignal?: AbortSignal;
  replyToId?: string | null;
}): Promise<ChatMessage> {
  const uploaded: Array<{
    id: string;
    url: string;
    media_type: "image" | "video" | "audio" | "document";
    file_name: string;
    file_size: number;
    mime_type: string;
    thumbnail_url?: string | null;
  }> = [];

  const n = args.files.length;
  for (let i = 0; i < n; i++) {
    const file = args.files[i];
    const meta = args.outboxMedia[i];

    // Per-attachment progress lives in [0..1]; we splice each into its
    // slice of the overall send. With n attachments, attachment i
    // occupies [i/n .. (i+1)/n].
    const sliceLo = i / n;
    const sliceHi = (i + 1) / n;
    const localToOverall = (frac: number, label?: string) => {
      args.onProgress?.(sliceLo + frac * (sliceHi - sliceLo), label);
    };

    // If the outbox already has an uploaded_url for this attachment
    // (mid-batch retry after a previous attempt got that far), skip
    // re-uploading.
    if (meta.uploaded_url) {
      uploaded.push({
        id: meta.attachment_id,
        url: meta.uploaded_url,
        media_type: meta.media_type,
        file_name: meta.file_name,
        file_size: meta.size,
        mime_type: meta.mime_type,
      });
      localToOverall(1, "Ready");
      continue;
    }

    // Run the pipeline. For images: compresses + returns a smaller
    // File. For videos: pushes to Cloudinary and returns the CDN URL.
    let processed: ProcessedAttachment;
    try {
      processed = await processAttachment(
        file,
        (p) => localToOverall(p.fraction, p.label),
        args.abortSignal
      );
    } catch (e) {
      // Validation / pipeline errors bubble up — the send fails as a
      // whole and the bubble flips to "failed" with the error message.
      throw e;
    }

    let finalUrl: string;
    if (processed.kind === "preuploaded") {
      // Cloudinary path. The URL is the CDN secure_url.
      finalUrl = processed.url;
    } else {
      // Supabase Storage path. Upload the (possibly compressed) file.
      localToOverall(0.98, "Saving…");
      finalUrl = await uploadMediaToStorage({
        conversationId: args.conversationId,
        blob: processed.file,
        fileName: processed.file.name,
        mimeType: processed.file.type || meta.mime_type,
      });
    }

    // Persist uploaded URL on the outbox so a future retry skips work.
    const nextMedia = args.outboxMedia.map((m, idx) =>
      idx === i ? { ...m, uploaded_url: finalUrl } : m
    );
    patchOutboxItem(args.outboxUserId, args.id, { media: nextMedia });

    uploaded.push({
      id: meta.attachment_id,
      url: finalUrl,
      media_type: processed.media_type,
      file_name: meta.file_name,
      file_size:
        processed.kind === "supabase" ? processed.file.size : processed.size,
      mime_type:
        processed.kind === "supabase"
          ? processed.file.type || meta.mime_type
          : processed.mime_type,
      thumbnail_url:
        processed.kind === "preuploaded" ? processed.thumbnail_url : null,
    });

    localToOverall(1, "Ready");

    // After each per-file upload, check the abort signal. Storage
    // uploads don't honour the signal mid-flight (the Supabase JS SDK
    // doesn't expose one), so a cancel tapped during the upload only
    // lands here, AFTER the upload completes. Without this check the
    // pipeline would barrel on into sendMediaMessage and the message
    // would ship to the server anyway — the exact "I tapped X and it
    // still sent" bug for short clips (voice notes, small docs).
    if (args.abortSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  }

  args.onProgress?.(1, "Finalising…");

  // Last-chance abort check before we commit the message + media row(s).
  // sendMediaMessage isn't cancellable once it starts, so this is the
  // last point where we can still bail without surfacing the message
  // server-side.
  if (args.abortSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  return sendMediaMessage({
    id: args.id,
    conversation_id: args.conversationId,
    sender_id: args.senderId,
    caption: args.caption || null,
    attachments: uploaded,
    reply_to_id: args.replyToId ?? null,
  });
}
