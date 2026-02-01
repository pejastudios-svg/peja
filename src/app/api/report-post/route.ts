import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { postId, reason, description } = await req.json();

    console.log("===========================================");
    console.log("[Report Post] START");
    console.log("[Report Post] User ID:", user.id);
    console.log("[Report Post] Post ID:", postId);
    console.log("[Report Post] Reason:", reason);
    console.log("===========================================");

    if (!postId || !reason) {
      return NextResponse.json({ ok: false, error: "Missing postId or reason" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1) Get post details
    const { data: post, error: postErr } = await supabaseAdmin
      .from("posts")
      .select("id, user_id, comment, report_count")
      .eq("id", postId)
      .single();

    if (postErr || !post) {
      console.log("[Report Post] ERROR: Post not found:", postId);
      return NextResponse.json({ ok: false, error: "Post not found" }, { status: 404 });
    }

    console.log("[Report Post] Found post, owner:", post.user_id);

    // 2) Prevent self-reporting
    if (post.user_id === user.id) {
      console.log("[Report Post] ERROR: Self-report blocked");
      return NextResponse.json({ ok: false, error: "Cannot report your own post" }, { status: 400 });
    }

    // 3) Check if user already reported this post
    const { data: existingReport } = await supabaseAdmin
      .from("post_reports")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingReport) {
      console.log("[Report Post] ERROR: User already reported this post");
      return NextResponse.json({ ok: false, error: "You have already reported this post" }, { status: 400 });
    }

    // 4) Insert report
    console.log("[Report Post] Inserting report...");
    const { error: reportErr } = await supabaseAdmin.from("post_reports").insert({
      post_id: postId,
      user_id: user.id,
      reason,
      description: description || null,
    });

    if (reportErr) {
      console.error("[Report Post] ERROR inserting report:", reportErr);
      if ((reportErr as any).code === "23505") {
        return NextResponse.json({ ok: false, error: "You have already reported this post" }, { status: 400 });
      }
      return NextResponse.json({ ok: false, error: reportErr.message }, { status: 400 });
    }

    console.log("[Report Post] Report inserted successfully");

    // 5) Count total reports for this post
    const { count: reportCount } = await supabaseAdmin
      .from("post_reports")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    const totalReports = reportCount || 1;
    console.log("[Report Post] Total reports for this post:", totalReports);

    // 6) Update report_count on post
    await supabaseAdmin
      .from("posts")
      .update({ report_count: totalReports })
      .eq("id", postId);

    // 7) Auto-archive if 3+ reports
    let archived = false;
    if (totalReports >= 3) {
      console.log("[Report Post] AUTO-ARCHIVING post (3+ reports)");

      await supabaseAdmin
        .from("posts")
        .update({ status: "archived" })
        .eq("id", postId);

      // Remove pending flags for this post
      await supabaseAdmin
        .from("flagged_content")
        .delete()
        .eq("post_id", postId)
        .is("comment_id", null)
        .eq("status", "pending");

      archived = true;

      // Notify post owner
      await supabaseAdmin.from("notifications").insert({
        user_id: post.user_id,
        type: "system",
        title: "Post removed",
        body: `Your post was removed due to multiple reports. Reason: ${reason}`,
        data: { post_id: postId, reason },
        is_read: false,
      });

      console.log("[Report Post] Post archived and owner notified");
    } else {
      // 8) Check for existing POST flag (where comment_id IS NULL)
      console.log("[Report Post] Checking for existing POST flag (comment_id = null)...");

      const { data: existingFlag, error: flagCheckErr } = await supabaseAdmin
        .from("flagged_content")
        .select("id")
        .eq("post_id", postId)
        .is("comment_id", null)
        .in("status", ["pending", "escalated"])
        .maybeSingle();

      if (flagCheckErr) {
        console.error("[Report Post] Error checking existing flag:", flagCheckErr);
      }

      console.log("[Report Post] Existing POST flag:", existingFlag?.id || "NONE");

      if (existingFlag) {
        // Update priority
        console.log("[Report Post] Updating existing flag priority to:", totalReports >= 2 ? "high" : "medium");
        await supabaseAdmin
          .from("flagged_content")
          .update({
            priority: totalReports >= 2 ? "high" : "medium",
            reason: reason,
          })
          .eq("id", existingFlag.id);
      } else {
        // Create NEW flagged_content entry for this POST
        console.log("[Report Post] Creating NEW flagged_content entry for POST...");

        const { data: newFlag, error: flagErr } = await supabaseAdmin
          .from("flagged_content")
          .insert({
            post_id: postId,
            comment_id: null,
            reason,
            source: "user",
            priority: totalReports >= 2 ? "high" : "medium",
            status: "pending",
          })
          .select("id")
          .single();

        if (flagErr) {
          console.error("[Report Post] ERROR creating flagged_content:", flagErr);
        } else if (newFlag) {
          console.log("[Report Post] Created flagged_content with ID:", newFlag.id);

          // Send notifications to moderators
          console.log("[Report Post] Sending moderator notifications...");
          await sendModeratorNotifications(supabaseAdmin, {
            flaggedId: newFlag.id,
            postId,
            reason,
            postContent: post.comment || "",
            reporterId: user.id,
          });
        }
      }
    }

    console.log("===========================================");
    console.log("[Report Post] SUCCESS");
    console.log("[Report Post] Total Reports:", totalReports);
    console.log("[Report Post] Archived:", archived);
    console.log("===========================================");

    return NextResponse.json({ ok: true, reportCount: totalReports, archived });
  } catch (e: any) {
    console.error("[Report Post] EXCEPTION:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

async function sendModeratorNotifications(
  supabaseAdmin: any,
  params: {
    flaggedId: string;
    postId: string;
    reason: string;
    postContent: string;
    reporterId: string;
  }
) {
  const { flaggedId, postId, reason, postContent, reporterId } = params;

  try {
    const { data: moderators, error: modErr } = await supabaseAdmin
      .from("users")
      .select("id, is_guardian, is_admin")
      .or("is_guardian.eq.true,is_admin.eq.true")
      .eq("status", "active")
      .neq("id", reporterId);

    if (modErr) {
      console.error("[Report Post] ERROR fetching moderators:", modErr);
      return;
    }

    if (!moderators || moderators.length === 0) {
      console.log("[Report Post] No moderators found to notify");
      return;
    }

    console.log("[Report Post] Found", moderators.length, "moderators to notify");

    const preview = postContent.length > 80 ? postContent.slice(0, 80) + "..." : postContent;

    const basePayload = {
      type: "flagged_post",
      title: "🚩 Post Reported",
      body: preview ? `"${preview}" — Reason: ${reason}` : `Reason: ${reason}`,
      data: {
        flagged_id: flaggedId,
        post_id: postId,
        reason,
        content_type: "post",
      },
      is_read: false,
      created_at: new Date().toISOString(),
    };

    const admins = moderators.filter((m: any) => m.is_admin === true);
    const guardians = moderators.filter((m: any) => m.is_guardian === true && m.is_admin !== true);

    console.log("[Report Post] Admins to notify:", admins.length);
    console.log("[Report Post] Guardians to notify:", guardians.length);

    if (admins.length > 0) {
      const adminNotifs = admins.map((a: any) => ({
        ...basePayload,
        recipient_id: a.id,
      }));

      console.log("[Report Post] Inserting admin notifications...");
      const { data: insertedAdmin, error: adminErr } = await supabaseAdmin
        .from("admin_notifications")
        .insert(adminNotifs)
        .select("id");

      if (adminErr) {
        console.error("[Report Post] ERROR inserting admin notifications:", adminErr);
      } else {
        console.log("[Report Post] SUCCESS: Inserted", insertedAdmin?.length || 0, "admin notifications");
      }
    }

    if (guardians.length > 0) {
      const guardianNotifs = guardians.map((g: any) => ({
        ...basePayload,
        recipient_id: g.id,
      }));

      console.log("[Report Post] Inserting guardian notifications...");
      const { data: insertedGuardian, error: guardianErr } = await supabaseAdmin
        .from("guardian_notifications")
        .insert(guardianNotifs)
        .select("id");

      if (guardianErr) {
        console.error("[Report Post] ERROR inserting guardian notifications:", guardianErr);
      } else {
        console.log("[Report Post] SUCCESS: Inserted", insertedGuardian?.length || 0, "guardian notifications");
      }
    }
  } catch (e) {
    console.error("[Report Post] EXCEPTION in sendModeratorNotifications:", e);
  }
}