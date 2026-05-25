// Post (incident report) outbox handler. Drains drafts that were
// queued while offline.
//
// Simplifications vs. the online handleSubmit in create/page.tsx:
//   - No media compression. Compression is a UX optimization for the
//     live flow; for a replay we prioritize getting the post UP and
//     accept slightly larger file sizes.
//   - All media goes to Supabase Storage (the "media" bucket) — no
//     Cloudinary fallback for videos. Keeps the offline path
//     dependency-free; the resulting post is functionally identical
//     from the consumer's POV (just a public URL on either side).
//   - No thumbnail generation for videos. The Storage URL is used
//     as-is; consumers fall back gracefully when thumbnail_url is
//     missing.
//
// If insert fails partway through (post row created but media row
// insert errors), the post row is left in place rather than rolled
// back — Supabase RLS doesn't really let us do atomic multi-table
// inserts from the client. The result is a post with missing media,
// which is recoverable and visible to admins.

import { supabase } from "../supabase";
import { getDraftBlob, deleteDraftBlobs } from "../postDraftBlobs";
import type { PostCreatePayload } from "../outbox";

export async function dispatchPostCreate(
  payload: PostCreatePayload,
): Promise<void> {
  // 1. Pull each blob back out of IDB and upload to Storage. We
  //    upload sequentially so a fail-on-one is easy to diagnose vs.
  //    a swarm of failed parallel uploads.
  const uploaded: Array<{ url: string; type: "photo" | "video" }> = [];
  for (const media of payload.media) {
    const blob = await getDraftBlob(payload.draft_id, media.media_id);
    if (!blob) {
      // Missing blob means the IDB store was cleared between queue
      // and drain (user cleared site data, etc.). Skip — we'd rather
      // post with fewer media than fail the whole draft.
      continue;
    }
    const ext =
      media.file_name.includes(".")
        ? media.file_name.split(".").pop()
        : media.mime_type.split("/")[1] || "bin";
    const path = `posts/${payload.user_id}/draft-${payload.draft_id}-${media.media_id}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("media")
      .upload(path, blob, {
        cacheControl: "3600",
        upsert: false,
        contentType: media.mime_type,
      });
    if (upErr) {
      throw new Error(`media upload failed: ${upErr.message}`);
    }
    const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
    uploaded.push({ url: pub.publicUrl, type: media.type });
  }

  // 2. Insert the posts row. Mirrors the online insert's column set
  //    so consumers don't see a different shape for offline-drafted
  //    posts. created_at preserved so the post sits in the timeline
  //    where it was drafted, not where it was synced.
  const { data: post, error: postErr } = await supabase
    .from("posts")
    .insert({
      user_id: payload.user_id,
      category: payload.category,
      comment: payload.comment,
      latitude: payload.latitude,
      longitude: payload.longitude,
      address: payload.address,
      country_code: payload.country_code,
      is_anonymous: payload.is_anonymous,
      is_sensitive: payload.is_sensitive,
      status: "live",
      confirmations: 0,
      views: 0,
      comment_count: 0,
      report_count: 0,
      created_at: payload.triggered_at,
    })
    .select("id")
    .single();

  if (postErr) {
    throw new Error(`post insert failed: ${postErr.message}`);
  }
  if (!post?.id) {
    throw new Error("post insert returned no id");
  }
  const postId = post.id as string;

  // 3. Post media rows. Non-fatal failure here leaves a media-less
  //    post — recoverable from admin.
  if (uploaded.length > 0) {
    const { error: mediaErr } = await supabase.from("post_media").insert(
      uploaded.map((m) => ({
        post_id: postId,
        url: m.url,
        media_type: m.type,
        is_sensitive: payload.is_sensitive,
      })),
    );
    if (mediaErr) {
      console.warn("[outbox/post] post_media insert failed", mediaErr);
    }
  }

  // 4. Tags. Same non-fatal treatment.
  if (payload.tags.length > 0) {
    const { error: tagsErr } = await supabase.from("post_tags").insert(
      payload.tags.map((tag) => ({ post_id: postId, tag })),
    );
    if (tagsErr) {
      console.warn("[outbox/post] post_tags insert failed", tagsErr);
    }
  }

  // 5. Clean up the IDB blobs — best-effort, safe to ignore on fail
  //    (worst case the blobs sit in IDB until the next session-clear).
  deleteDraftBlobs(payload.draft_id).catch(() => {});
}
