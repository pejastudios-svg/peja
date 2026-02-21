import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

const ALLOWED = ["approve", "blur", "remove", "escalate"] as const;
type Action = (typeof ALLOWED)[number];

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAdmin(req);

    const { flaggedId, action } = await req.json();

    if (!flaggedId || !ALLOWED.includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Fetch flagged row to get post_id and comment_id
    const { data: flagged, error: flagErr } = await supabaseAdmin
      .from("flagged_content")
      .select("id, post_id, comment_id, reason")
      .eq("id", flaggedId)
      .single();

    if (flagErr || !flagged) {
      return NextResponse.json({ ok: false, error: "Flag not found" }, { status: 404 });
    }

    const isComment = !!flagged.comment_id;

    const newStatus =
      action === "approve" ? "approved" :
      action === "escalate" ? "escalated" :
      "removed";

    // Update flagged content status
    const { error: updFlagErr } = await supabaseAdmin
      .from("flagged_content")
      .update({
        status: newStatus,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", flaggedId);

    if (updFlagErr) throw updFlagErr;

    // Handle comment actions
    if (isComment && flagged.comment_id) {
      if (action === "remove") {
        // Get comment details for notification
        const { data: comment } = await supabaseAdmin
          .from("post_comments")
          .select("user_id, post_id")
          .eq("id", flagged.comment_id)
          .single();

        if (comment) {
          // Delete related data
          await supabaseAdmin.from("comment_likes").delete().eq("comment_id", flagged.comment_id);
          await supabaseAdmin.from("comment_media").delete().eq("comment_id", flagged.comment_id);
          await supabaseAdmin.from("comment_reports").delete().eq("comment_id", flagged.comment_id);
          
          // Delete the comment
          await supabaseAdmin.from("post_comments").delete().eq("id", flagged.comment_id);

          // Decrement comment count
          await supabaseAdmin.rpc("decrement_comment_count", { post_id: comment.post_id });

          // Notify the comment owner
          await supabaseAdmin.from("notifications").insert({
            user_id: comment.user_id,
            type: "system",
            title: "Comment removed",
            body: `Your comment was removed by a moderator. Reason: ${flagged.reason}`,
            data: { post_id: comment.post_id, reason: flagged.reason },
            is_read: false,
          });
        }
      }
    }

    // Handle post actions
    if (!isComment && flagged.post_id) {
      if (action === "remove") {
        // Get post owner for notification
        const { data: post } = await supabaseAdmin
          .from("posts")
          .select("user_id")
          .eq("id", flagged.post_id)
          .single();

        await supabaseAdmin.from("posts").update({ status: "archived" }).eq("id", flagged.post_id);

        // Notify the post owner
        if (post) {
          await supabaseAdmin.from("notifications").insert({
            user_id: post.user_id,
            type: "system",
            title: "Post removed",
            body: `Your post was removed by a moderator. Reason: ${flagged.reason}`,
            data: { post_id: flagged.post_id, reason: flagged.reason },
            is_read: false,
          });
        }
      }

      if (action === "blur") {
        await supabaseAdmin.from("posts").update({ is_sensitive: true }).eq("id", flagged.post_id);
        await supabaseAdmin.from("post_media").update({ is_sensitive: true }).eq("post_id", flagged.post_id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}