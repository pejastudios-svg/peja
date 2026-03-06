import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

const ALLOWED = ["approve", "blur", "remove", "escalate"] as const;
type Action = (typeof ALLOWED)[number];

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);

    const supabaseAdmin = getSupabaseAdmin();

    const { data: userData, error: userErr } = await supabaseAdmin
      .from("users")
      .select("is_guardian, is_admin")
      .eq("id", user.id)
      .single();

    if (userErr || (!userData?.is_guardian && !userData?.is_admin)) {
      return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
    }

    const { flaggedId, action } = await req.json();

    if (!flaggedId || !ALLOWED.includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    // Fetch flagged row
    const { data: flagged, error: flagErr } = await supabaseAdmin
      .from("flagged_content")
      .select("id, post_id, comment_id, reason, status")
      .eq("id", flaggedId)
      .single();

    if (flagErr || !flagged) {
      return NextResponse.json({ ok: false, error: "Flag not found" }, { status: 404 });
    }

    // Prevent double review
    if (flagged.status !== "pending" && flagged.status !== "escalated") {
      return NextResponse.json(
        { ok: false, error: "Already reviewed by another moderator" },
        { status: 409 }
      );
    }

    const isComment = !!flagged.comment_id;

    const newStatus =
      action === "approve" ? "approved" :
      action === "blur" ? "blurred" :
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
        const { data: comment } = await supabaseAdmin
          .from("post_comments")
          .select("user_id, post_id")
          .eq("id", flagged.comment_id)
          .single();

        if (comment) {
          await supabaseAdmin.from("comment_likes").delete().eq("comment_id", flagged.comment_id);
          await supabaseAdmin.from("comment_media").delete().eq("comment_id", flagged.comment_id);
          await supabaseAdmin.from("comment_reports").delete().eq("comment_id", flagged.comment_id);
          await supabaseAdmin.from("post_comments").delete().eq("id", flagged.comment_id);
          await supabaseAdmin.rpc("decrement_comment_count", { post_id: comment.post_id });

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
        const { data: post } = await supabaseAdmin
          .from("posts")
          .select("user_id")
          .eq("id", flagged.post_id)
          .single();

        await supabaseAdmin.from("posts").update({ status: "archived" }).eq("id", flagged.post_id);

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

    // Notify admins when guardian escalates
    if (action === "escalate") {
      let preview = "";
      if (isComment && flagged.comment_id) {
        const { data: comment } = await supabaseAdmin
          .from("post_comments")
          .select("content")
          .eq("id", flagged.comment_id)
          .single();
        preview = comment?.content?.slice(0, 60) || "";
      } else if (flagged.post_id) {
        const { data: post } = await supabaseAdmin
          .from("posts")
          .select("comment")
          .eq("id", flagged.post_id)
          .single();
        preview = post?.comment?.slice(0, 60) || "";
      }

      const { data: admins } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("is_admin", true)
        .eq("status", "active")
        .neq("id", user.id);

      if (admins && admins.length > 0) {
        const contentType = isComment ? "comment" : "post";

        const adminNotifications = admins.map((admin) => ({
          recipient_id: admin.id,
          type: `escalated_${contentType}`,
          title: `🚨 Escalated ${contentType}`,
          body: preview
            ? `"${preview}${preview.length >= 60 ? "..." : ""}" — Reason: ${flagged.reason}`
            : `Reason: ${flagged.reason}`,
          data: {
            flagged_id: flagged.id,
            post_id: flagged.post_id,
            comment_id: flagged.comment_id || null,
            reason: flagged.reason,
            escalated_by: user.id,
            content_type: contentType,
          },
          is_read: false,
          created_at: new Date().toISOString(),
        }));

        await supabaseAdmin.from("admin_notifications").insert(adminNotifications);
      }
    }

    // ============================================================
    // CLEAN UP NOTIFICATIONS (fixes badge issue)
    // ============================================================

    // Delete ALL guardian notifications referencing this flagged item
    // This clears the badge for ALL guardians
    try {
      await supabaseAdmin
        .from("guardian_notifications")
        .delete()
        .contains("data", { flagged_id: flaggedId });
    } catch (e) {
      console.error("[review-flagged] Failed to cleanup guardian notifications:", e);
    }

    // For non-escalate actions, mark admin notifications as read (keeps history)
    if (action !== "escalate") {
      try {
        await supabaseAdmin
          .from("admin_notifications")
          .update({ is_read: true })
          .contains("data", { flagged_id: flaggedId });
      } catch (e) {
        console.error("[review-flagged] Failed to mark admin notifications as read:", e);
      }
    }

    // Log guardian action
    try {
      await supabaseAdmin.from("guardian_actions").insert({
        guardian_id: user.id,
        action,
        post_id: flagged.post_id,
        comment_id: flagged.comment_id || null,
        reason: flagged.reason,
      });
    } catch (e) {
      console.error("[review-flagged] Failed to log guardian action:", e);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}