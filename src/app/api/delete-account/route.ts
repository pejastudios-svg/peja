import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../_supabaseAdmin";

export async function DELETE(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseAdmin = getSupabaseAdmin();
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = user.id;

    // Optional self-deletion reason (e.g. "Too many notifications"). Used
    // by the audit log only — doesn't gate the deletion itself.
    let deletionReason: string | null = null;
    try {
      const body = await req.json();
      if (body?.reason && typeof body.reason === "string") {
        deletionReason = body.reason.trim() || null;
      }
    } catch {}

    // Snapshot identifying fields before the cascade tears the row down.
    let snapshotEmail: string | null = null;
    let snapshotName: string | null = null;
    try {
      const { data: self } = await supabaseAdmin
        .from("users")
        .select("email, full_name")
        .eq("id", userId)
        .single();
      snapshotEmail = self?.email ?? null;
      snapshotName = self?.full_name ?? null;
    } catch {}

    // Audit log written first so the record survives even if a downstream
    // delete throws partway through.
    try {
      await supabaseAdmin.from("user_deletion_log").insert({
        user_id: userId,
        user_email: snapshotEmail,
        user_full_name: snapshotName,
        deleted_by: userId,
        deletion_reason: deletionReason,
        initiated_by: "user",
      });
    } catch {}

    // Helper: silently ignore errors from missing tables/columns
    const safeDelete = async (table: string, column: string, value: string) => {
      try {
        await supabaseAdmin.from(table).delete().eq(column, value);
      } catch {}
    };

    const safeDeleteOr = async (table: string, conditions: string) => {
      try {
        await supabaseAdmin.from(table).delete().or(conditions);
      } catch {}
    };

    const safeDeleteIn = async (table: string, column: string, values: string[]) => {
      if (!values.length) return;
      try {
        await supabaseAdmin.from(table).delete().in(column, values);
      } catch {}
    };

    // =====================================================
    // 1. Delete data related to user's POSTS
    // =====================================================
    const { data: userPosts } = await supabaseAdmin
      .from("posts")
      .select("id")
      .eq("user_id", userId);

    const postIds = (userPosts || []).map((p: any) => p.id);

    if (postIds.length > 0) {
      const { data: postComments } = await supabaseAdmin
        .from("post_comments")
        .select("id")
        .in("post_id", postIds);
      const commentIds = (postComments || []).map((c: any) => c.id);

      if (commentIds.length > 0) {
        await safeDeleteIn("comment_likes", "comment_id", commentIds);
        await safeDeleteIn("comment_media", "comment_id", commentIds);
        await safeDeleteIn("flagged_content", "comment_id", commentIds);
        await safeDeleteIn("guardian_actions", "comment_id", commentIds);
      }

      await safeDeleteIn("post_comments", "post_id", postIds);
      await safeDeleteIn("post_media", "post_id", postIds);
      await safeDeleteIn("post_tags", "post_id", postIds);
      await safeDeleteIn("post_confirmations", "post_id", postIds);
      await safeDeleteIn("post_reports", "post_id", postIds);
      await safeDeleteIn("flagged_content", "post_id", postIds);
      await safeDeleteIn("guardian_actions", "post_id", postIds);
    }

    // =====================================================
    // 2. Delete user's COMMENTS on other posts
    // =====================================================
    const { data: userComments } = await supabaseAdmin
      .from("post_comments")
      .select("id")
      .eq("user_id", userId);
    const userCommentIds = (userComments || []).map((c: any) => c.id);

    if (userCommentIds.length > 0) {
      await safeDeleteIn("comment_likes", "comment_id", userCommentIds);
      await safeDeleteIn("comment_media", "comment_id", userCommentIds);
      await safeDeleteIn("flagged_content", "comment_id", userCommentIds);
      await safeDeleteIn("guardian_actions", "comment_id", userCommentIds);
    }

    await safeDelete("post_comments", "user_id", userId);
    await safeDelete("comment_likes", "user_id", userId);
    await safeDelete("comment_reports", "user_id", userId);
    await safeDelete("post_confirmations", "user_id", userId);
    await safeDelete("post_reports", "user_id", userId);

    // Delete user's posts
    await safeDelete("posts", "user_id", userId);

    // =====================================================
    // 3. Delete MESSAGES and CONVERSATIONS
    // =====================================================
    const { data: convParts } = await supabaseAdmin
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", userId);

    const convIds = (convParts || []).map((c: any) => c.conversation_id);

    if (convIds.length > 0) {
      for (const convId of convIds) {
        const { data: convMsgs } = await supabaseAdmin
          .from("messages")
          .select("id")
          .eq("conversation_id", convId);
        const msgIds = (convMsgs || []).map((m: any) => m.id);

        if (msgIds.length > 0) {
          await safeDeleteIn("message_reactions", "message_id", msgIds);
          await safeDeleteIn("message_read_receipts", "message_id", msgIds);
          await safeDeleteIn("message_reads", "message_id", msgIds);
          await safeDeleteIn("message_media", "message_id", msgIds);
          await safeDeleteIn("message_deletions", "message_id", msgIds);
        }

        await safeDelete("messages", "conversation_id", convId);
        await safeDelete("typing_indicators", "conversation_id", convId);
        await safeDelete("conversation_participants", "conversation_id", convId);

        try {
          await supabaseAdmin.from("conversations").delete().eq("id", convId);
        } catch {}
      }
    }

    await safeDeleteOr("dm_blocks", `blocker_id.eq.${userId},blocked_id.eq.${userId}`);
    await safeDelete("message_reactions", "user_id", userId);
    await safeDelete("message_read_receipts", "user_id", userId);
    await safeDelete("message_reads", "user_id", userId);
    await safeDelete("message_deletions", "user_id", userId);

    // =====================================================
    // 4. Delete all OTHER user data
    // =====================================================
    await safeDelete("notifications", "user_id", userId);
    await safeDelete("admin_notifications", "recipient_id", userId);
    await safeDeleteOr("emergency_contacts", `user_id.eq.${userId},contact_user_id.eq.${userId}`);
    await safeDelete("sos_alerts", "user_id", userId);
    await safeDelete("user_settings", "user_id", userId);
    await safeDelete("user_sessions", "user_id", userId);
    await safeDelete("user_push_tokens", "user_id", userId);
    await safeDelete("user_warnings", "user_id", userId);
    await safeDelete("guardian_applications", "user_id", userId);
    await safeDelete("guardian_actions", "guardian_id", userId);
    await safeDelete("guardian_notifications", "recipient_id", userId);
    await safeDelete("app_events", "user_id", userId);
    await safeDelete("flagged_content", "flagged_by", userId);
    await safeDelete("saved_locations", "user_id", userId);
    await safeDelete("admin_access_log", "user_id", userId);
    await safeDelete("admin_logs", "admin_id", userId);
    await safeDelete("verification_codes", "user_id", userId);

    // =====================================================
    // 5. Delete the USER record
    // =====================================================
    const { error: userDeleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", userId);

    if (userDeleteError) {
      return NextResponse.json(
        { error: `Failed to delete user: ${userDeleteError.message}` },
        { status: 500 }
      );
    }

    // =====================================================
    // 6. Delete the AUTH user
    // =====================================================
    try {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    } catch {}

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete account" },
      { status: 500 }
    );
  }
}