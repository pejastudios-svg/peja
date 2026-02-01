import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { commentId, reason, description } = await req.json();

    console.log("===========================================");
    console.log("[Report Comment] START");
    console.log("[Report Comment] User ID:", user.id);
    console.log("[Report Comment] Comment ID:", commentId);
    console.log("[Report Comment] Reason:", reason);
    console.log("===========================================");

    if (!commentId || !reason) {
      return NextResponse.json({ ok: false, error: "Missing commentId or reason" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1) Get comment details
    const { data: comment, error: commentErr } = await supabaseAdmin
      .from("post_comments")
      .select("id, post_id, user_id, content, report_count")
      .eq("id", commentId)
      .single();

    if (commentErr || !comment) {
      console.log("[Report Comment] ERROR: Comment not found:", commentId);
      return NextResponse.json({ ok: false, error: "Comment not found" }, { status: 404 });
    }

    console.log("[Report Comment] Found comment on post:", comment.post_id);
    console.log("[Report Comment] Comment owner:", comment.user_id);

    // 2) Prevent self-reporting
    if (comment.user_id === user.id) {
      console.log("[Report Comment] ERROR: Self-report blocked");
      return NextResponse.json({ ok: false, error: "Cannot report your own comment" }, { status: 400 });
    }

    // 3) Check if this user already reported THIS SPECIFIC comment
    const { data: existingReport } = await supabaseAdmin
      .from("comment_reports")
      .select("id")
      .eq("comment_id", commentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingReport) {
      console.log("[Report Comment] ERROR: User already reported this comment");
      return NextResponse.json({ ok: false, error: "You have already reported this comment" }, { status: 400 });
    }

    // 4) Insert report
    console.log("[Report Comment] Inserting report...");
    const { error: reportErr } = await supabaseAdmin.from("comment_reports").insert({
      comment_id: commentId,
      user_id: user.id,
      reason,
      description: description || null,
    });

    if (reportErr) {
      console.error("[Report Comment] ERROR inserting report:", reportErr);
      if ((reportErr as any).code === "23505") {
        return NextResponse.json({ ok: false, error: "You have already reported this comment" }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: reportErr.message }, { status: 400 });
    }

    console.log("[Report Comment] Report inserted successfully");

    // 5) Count total reports for this comment
    const { count: reportCount } = await supabaseAdmin
      .from("comment_reports")
      .select("*", { count: "exact", head: true })
      .eq("comment_id", commentId);

    const totalReports = reportCount || 1;
    console.log("[Report Comment] Total reports for this comment:", totalReports);

    // 6) Update report_count on comment
    await supabaseAdmin
      .from("post_comments")
      .update({ report_count: totalReports })
      .eq("id", commentId);

    // 7) Auto-delete if 3+ reports
    let deleted = false;
    if (totalReports >= 3) {
      console.log("[Report Comment] AUTO-DELETING comment (3+ reports)");

      await supabaseAdmin.from("comment_likes").delete().eq("comment_id", commentId);
      await supabaseAdmin.from("comment_media").delete().eq("comment_id", commentId);
      await supabaseAdmin.from("comment_reports").delete().eq("comment_id", commentId);
      await supabaseAdmin.from("flagged_content").delete().eq("comment_id", commentId);

      const { error: deleteErr } = await supabaseAdmin
        .from("post_comments")
        .delete()
        .eq("id", commentId);

      if (!deleteErr) {
        deleted = true;
        await supabaseAdmin.rpc("decrement_comment_count", { post_id: comment.post_id });

        await supabaseAdmin.from("notifications").insert({
          user_id: comment.user_id,
          type: "system",
          title: "Comment removed",
          body: `Your comment was removed due to multiple reports. Reason: ${reason}`,
          data: { post_id: comment.post_id, reason },
          is_read: false,
        });
      }

      console.log("[Report Comment] Comment deleted:", deleted);
    } else {
      // 8) Check for existing flag for THIS SPECIFIC COMMENT
      console.log("[Report Comment] Checking for existing flag for comment:", commentId);
      
      const { data: existingFlag, error: flagCheckErr } = await supabaseAdmin
        .from("flagged_content")
        .select("id")
        .eq("comment_id", commentId)
        .in("status", ["pending", "escalated"])
        .maybeSingle();

      if (flagCheckErr) {
        console.error("[Report Comment] Error checking existing flag:", flagCheckErr);
      }

      console.log("[Report Comment] Existing flag for this comment:", existingFlag?.id || "NONE");

      if (existingFlag) {
        // Update priority
        console.log("[Report Comment] Updating existing flag priority to:", totalReports >= 2 ? "high" : "medium");
        await supabaseAdmin
          .from("flagged_content")
          .update({
            priority: totalReports >= 2 ? "high" : "medium",
            reason: reason,
          })
          .eq("id", existingFlag.id);
      } else {
        // Create NEW flagged_content entry for this comment
        console.log("[Report Comment] Creating NEW flagged_content entry...");

        const { data: newFlag, error: flagErr } = await supabaseAdmin
          .from("flagged_content")
          .insert({
            comment_id: commentId,
            post_id: comment.post_id,
            reason,
            source: "user",
            priority: totalReports >= 2 ? "high" : "medium",
            status: "pending",
          })
          .select("id")
          .single();

        if (flagErr) {
          console.error("[Report Comment] ERROR creating flagged_content:", flagErr);
        } else if (newFlag) {
          console.log("[Report Comment] Created flagged_content with ID:", newFlag.id);

          // Send notifications to moderators
          console.log("[Report Comment] Sending moderator notifications...");
          await sendModeratorNotifications(supabaseAdmin, {
            flaggedId: newFlag.id,
            commentId,
            postId: comment.post_id,
            reason,
            commentContent: comment.content || "",
            reporterId: user.id,
          });
        }
      }
    }

    console.log("===========================================");
    console.log("[Report Comment] SUCCESS");
    console.log("[Report Comment] Total Reports:", totalReports);
    console.log("[Report Comment] Deleted:", deleted);
    console.log("===========================================");

    return NextResponse.json({ ok: true, reportCount: totalReports, deleted });
  } catch (e: any) {
    console.error("[Report Comment] EXCEPTION:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

async function sendModeratorNotifications(
  supabaseAdmin: any,
  params: {
    flaggedId: string;
    commentId: string;
    postId: string;
    reason: string;
    commentContent: string;
    reporterId: string;
  }
) {
  const { flaggedId, commentId, postId, reason, commentContent, reporterId } = params;

  try {
    // Get all active guardians and admins
    const { data: moderators, error: modErr } = await supabaseAdmin
      .from("users")
      .select("id, is_guardian, is_admin")
      .or("is_guardian.eq.true,is_admin.eq.true")
      .eq("status", "active")
      .neq("id", reporterId);

    if (modErr) {
      console.error("[Report Comment] ERROR fetching moderators:", modErr);
      return;
    }

    if (!moderators || moderators.length === 0) {
      console.log("[Report Comment] No moderators found to notify");
      return;
    }

    console.log("[Report Comment] Found", moderators.length, "moderators to notify");

    const preview = commentContent.length > 80 ? commentContent.slice(0, 80) + "..." : commentContent;

    const basePayload = {
      type: "flagged_comment",
      title: "🚩 Comment Reported",
      body: `"${preview}" — Reason: ${reason}`,
      data: {
        flagged_id: flaggedId,
        comment_id: commentId,
        post_id: postId,
        reason,
        content_type: "comment",
      },
      is_read: false,
      created_at: new Date().toISOString(),
    };

    // Separate admins and guardians
    const admins = moderators.filter((m: any) => m.is_admin === true);
    const guardians = moderators.filter((m: any) => m.is_guardian === true && m.is_admin !== true);

    console.log("[Report Comment] Admins to notify:", admins.length);
    console.log("[Report Comment] Guardians to notify:", guardians.length);

    // Insert admin notifications
    if (admins.length > 0) {
      const adminNotifs = admins.map((a: any) => ({
        ...basePayload,
        recipient_id: a.id,
      }));

      console.log("[Report Comment] Inserting admin notifications...");
      const { data: insertedAdmin, error: adminErr } = await supabaseAdmin
        .from("admin_notifications")
        .insert(adminNotifs)
        .select("id");

      if (adminErr) {
        console.error("[Report Comment] ERROR inserting admin notifications:", adminErr);
      } else {
        console.log("[Report Comment] SUCCESS: Inserted", insertedAdmin?.length || 0, "admin notifications");
      }
    }

    // Insert guardian notifications
    if (guardians.length > 0) {
      const guardianNotifs = guardians.map((g: any) => ({
        ...basePayload,
        recipient_id: g.id,
      }));

      console.log("[Report Comment] Inserting guardian notifications...");
      const { data: insertedGuardian, error: guardianErr } = await supabaseAdmin
        .from("guardian_notifications")
        .insert(guardianNotifs)
        .select("id");

      if (guardianErr) {
        console.error("[Report Comment] ERROR inserting guardian notifications:", guardianErr);
      } else {
        console.log("[Report Comment] SUCCESS: Inserted", insertedGuardian?.length || 0, "guardian notifications");
      }
    }
  } catch (e) {
    console.error("[Report Comment] EXCEPTION in sendModeratorNotifications:", e);
  }
}