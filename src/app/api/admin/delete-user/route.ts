import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser } from "../../_auth";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    // Verify caller is admin
    const { data: adminCheck } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    if (userId === user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

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
      // Get all comments on user's posts
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
        // Get all message IDs in conversation
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

        // Delete conversation itself
        try {
          await supabaseAdmin.from("conversations").delete().eq("id", convId);
        } catch {}
      }
    }

    await safeDeleteOr("dm_blocks", `blocker_id.eq.${userId},blocked_id.eq.${userId}`);

    // Clean up any remaining message data
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

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || "Server error" },
      { status: 500 }
    );
  }
}