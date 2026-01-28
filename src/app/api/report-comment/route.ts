import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { commentId, reason, description } = await req.json();
    if (!commentId || !reason) {
      return NextResponse.json({ ok: false, error: "Missing commentId or reason" }, { status: 400 });
    }
    const supabaseAdmin = getSupabaseAdmin();
    // 1) Check if comment exists and get post_id
    const { data: comment, error: commentErr } = await supabaseAdmin
      .from("post_comments")
      .select("id, post_id, user_id, report_count")
      .eq("id", commentId)
      .single();
    if (commentErr || !comment) {
      return NextResponse.json({ ok: false, error: "Comment not found" }, { status: 404 });
    }
    // 2) Prevent self-reporting
    if (comment.user_id === user.id) {
      return NextResponse.json({ ok: false, error: "Cannot report your own comment" }, { status: 400 });
    }
    // 3) Insert report (ignore duplicates if unique constraint exists)
    const { error: reportErr } = await supabaseAdmin.from("comment_reports").insert({
      comment_id: commentId,
      user_id: user.id,
      reason,
      description: description || null,
    });
    // Check for duplicate report (unique constraint violation)
    if (reportErr) {
      if ((reportErr as any).code === "23505") {
        return NextResponse.json({ ok: false, error: "You have already reported this comment" }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: reportErr.message }, { status: 400 });
    }
    // 4) Count total reports for this comment
    const { count: reportCount, error: countErr } = await supabaseAdmin
      .from("comment_reports")
      .select("*", { count: "exact", head: true })
      .eq("comment_id", commentId);
    if (countErr) {
      return NextResponse.json({ ok: false, error: countErr.message }, { status: 400 });
    }
    const totalReports = reportCount || 0;
    // 5) Update report_count on comment
    const { error: updateErr } = await supabaseAdmin
      .from("post_comments")
      .update({ report_count: totalReports })
      .eq("id", commentId);
    if (updateErr) {
      console.error("Failed to update comment report_count:", updateErr);
    }
    // 6) Auto-delete if 3+ reports from different users
    let deleted = false;
    if (totalReports >= 3) {
      // Delete comment likes first
      await supabaseAdmin.from("comment_likes").delete().eq("comment_id", commentId);
      
      // Delete comment media
      await supabaseAdmin.from("comment_media").delete().eq("comment_id", commentId);
      
      // Delete the reports
      await supabaseAdmin.from("comment_reports").delete().eq("comment_id", commentId);
      
      // Delete the comment itself
      const { error: deleteErr } = await supabaseAdmin
        .from("post_comments")
        .delete()
        .eq("id", commentId);
      if (!deleteErr) {
        deleted = true;
        // Decrement comment_count on the post
        await supabaseAdmin.rpc("decrement_comment_count", { post_id: comment.post_id });
        // Notify the comment owner that their comment was removed
        await supabaseAdmin.from("notifications").insert({
          user_id: comment.user_id,
          type: "system",
          title: "Comment removed",
          body: `Your comment was removed due to multiple reports. Reason: ${reason}`,
          data: { post_id: comment.post_id, reason },
          is_read: false,
        });
      }
    } else {
      // If not auto-deleted, create a flagged_content entry for admin/guardian review
      // Check if already flagged
      const { data: existingFlag } = await supabaseAdmin
        .from("flagged_content")
        .select("id")
        .eq("comment_id", commentId)
        .eq("status", "pending")
        .single();
      if (!existingFlag) {
        await supabaseAdmin.from("flagged_content").insert({
          comment_id: commentId,
          post_id: comment.post_id,
          reason,
          source: "user",
          priority: totalReports >= 2 ? "high" : "medium",
          status: "pending",
        });
      }
    }
    return NextResponse.json({ 
      ok: true, 
      reportCount: totalReports, 
      deleted 
    });
  } catch (e: any) {
    console.error("Report comment error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}