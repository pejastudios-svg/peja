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

    // 1) Get comment details
    const { data: comment, error: commentErr } = await supabaseAdmin
      .from("post_comments")
      .select("id, post_id, user_id, content, report_count")
      .eq("id", commentId)
      .single();

    if (commentErr || !comment) {
      return NextResponse.json({ ok: false, error: "Comment not found" }, { status: 404 });
    }


    // 2) Prevent self-reporting
    if (comment.user_id === user.id) {
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
      return NextResponse.json({ ok: false, error: "You have already reported this comment" }, { status: 400 });
    }

    // 4) Insert report
    const { error: reportErr } = await supabaseAdmin.from("comment_reports").insert({
      comment_id: commentId,
      user_id: user.id,
      reason,
      description: description || null,
    });

    if (reportErr) {
      if ((reportErr as any).code === "23505") {
        return NextResponse.json({ ok: false, error: "You have already reported this comment" }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: reportErr.message }, { status: 400 });
    }


    // 5) Count total reports for this comment
    const { count: reportCount } = await supabaseAdmin
      .from("comment_reports")
      .select("*", { count: "exact", head: true })
      .eq("comment_id", commentId);

    const totalReports = reportCount || 1;

    // 6) Update report_count on comment
    await supabaseAdmin
      .from("post_comments")
      .update({ report_count: totalReports })
      .eq("id", commentId);

    // 7) Auto-delete if 5+ reports
    let deleted = false;
    if (totalReports >= 5) {

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

    } else {
      // 8) Check for existing flag for THIS SPECIFIC COMMENT
      
      const { data: existingFlag, error: flagCheckErr } = await supabaseAdmin
        .from("flagged_content")
        .select("id")
        .eq("comment_id", commentId)
        .in("status", ["pending", "escalated"])
        .maybeSingle();

      if (flagCheckErr) {
      }


      if (existingFlag) {
        // Update priority
        await supabaseAdmin
          .from("flagged_content")
          .update({
            priority: totalReports >= 2 ? "high" : "medium",
            reason: reason,
          })
          .eq("id", existingFlag.id);
      } else {
        // Create NEW flagged_content entry for this comment

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
        } else if (newFlag) {

          // Send notifications to moderators
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


    return NextResponse.json({ ok: true, reportCount: totalReports, deleted });
  } catch (e: any) {
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
      return;
    }

    if (!moderators || moderators.length === 0) {
      return;
    }


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


    // Insert admin notifications
    if (admins.length > 0) {
      const adminNotifs = admins.map((a: any) => ({
        ...basePayload,
        recipient_id: a.id,
      }));

      const { data: insertedAdmin, error: adminErr } = await supabaseAdmin
        .from("admin_notifications")
        .insert(adminNotifs)
        .select("id");

      if (adminErr) {
      } else {
      }
    }

    // Insert guardian notifications
    if (guardians.length > 0) {
      const guardianNotifs = guardians.map((g: any) => ({
        ...basePayload,
        recipient_id: g.id,
      }));

      const { data: insertedGuardian, error: guardianErr } = await supabaseAdmin
        .from("guardian_notifications")
        .insert(guardianNotifs)
        .select("id");

      if (guardianErr) {
      } else {
      }
    }
  } catch (e) {
  }
}