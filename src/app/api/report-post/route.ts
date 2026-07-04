import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";
import { isRateLimitedDurable } from "../_rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);

    // Throttle so a user can't rapidly report many posts and fan out
    // moderator notifications. Per-target dedup still applies below.
    if (await isRateLimitedDurable(`report:${user.id}`, 20, 10 * 60)) {
      return NextResponse.json({ ok: false, error: "Too many reports. Please slow down." }, { status: 429 });
    }

    const { postId, reason, description } = await req.json();

    if (!postId || typeof postId !== "string") {
      return NextResponse.json({ ok: false, error: "Missing postId" }, { status: 400 });
    }
    // Cap the free-text fields so a report can't store megabytes of text or
    // stuff huge strings into the moderator notifications it fans out.
    if (!reason || typeof reason !== "string" || reason.length > 100) {
      return NextResponse.json({ ok: false, error: "Invalid reason" }, { status: 400 });
    }
    const safeDescription =
      typeof description === "string" ? description.slice(0, 1000) : null;

    const supabaseAdmin = getSupabaseAdmin();

    // 1) Get post details
    const { data: post, error: postErr } = await supabaseAdmin
      .from("posts")
      .select("id, user_id, comment, report_count")
      .eq("id", postId)
      .single();

    if (postErr || !post) {
      return NextResponse.json({ ok: false, error: "Post not found" }, { status: 404 });
    }


    // 2) Prevent self-reporting
    if (post.user_id === user.id) {
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
      return NextResponse.json({ ok: false, error: "You have already reported this post" }, { status: 400 });
    }

    // 4) Insert report
    const { error: reportErr } = await supabaseAdmin.from("post_reports").insert({
      post_id: postId,
      user_id: user.id,
      reason,
      description: safeDescription,
    });

    if (reportErr) {
      if ((reportErr as any).code === "23505") {
        return NextResponse.json({ ok: false, error: "You have already reported this post" }, { status: 400 });
      }
      console.error("[report-post] insert failed", reportErr);
      return NextResponse.json({ ok: false, error: "Failed to submit report" }, { status: 400 });
    }


    // 5) Count total reports for this post
    const { count: reportCount } = await supabaseAdmin
      .from("post_reports")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    const totalReports = reportCount || 1;

    // 6) Update report_count on post
    await supabaseAdmin
      .from("posts")
      .update({ report_count: totalReports })
      .eq("id", postId);

    // 7) Auto-archive when 10 distinct users have reported.
    //    Unique (post_id, user_id) constraint means totalReports already
    //    equals distinct reporters.
    let archived = false;
    if (totalReports >= 10) {

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

    } else {
      // 8) Check for existing POST flag (where comment_id IS NULL)

      const { data: existingFlag, error: flagCheckErr } = await supabaseAdmin
        .from("flagged_content")
        .select("id")
        .eq("post_id", postId)
        .is("comment_id", null)
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
        // Create NEW flagged_content entry for this POST

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
        } else if (newFlag) {

          // Send notifications to moderators
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


    return NextResponse.json({ ok: true, reportCount: totalReports, archived });
  } catch (e: any) {
    console.error("[report-post] failed", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
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
      return;
    }

    if (!moderators || moderators.length === 0) {
      return;
    }


    const preview = postContent.length > 80 ? postContent.slice(0, 80) + "..." : postContent;

    const basePayload = {
      type: "flagged_post",
      title: "🚩 Post Reported",
      body: preview ? `"${preview}". Reason: ${reason}` : `Reason: ${reason}`,
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