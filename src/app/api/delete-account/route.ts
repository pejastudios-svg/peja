import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../_supabaseAdmin";

export async function DELETE(req: NextRequest) {
  try {
    // Get the authorization header to verify the user
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify the token and get the user
    const supabaseAdmin = getSupabaseAdmin();
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const userId = user.id;

    // Delete all user data in order (respecting foreign keys)
    
    // 1. Delete post_media for user's posts
    const { data: userPosts } = await supabaseAdmin
      .from("posts")
      .select("id")
      .eq("user_id", userId);
    
    if (userPosts && userPosts.length > 0) {
      const postIds = userPosts.map(p => p.id);
      await supabaseAdmin.from("post_media").delete().in("post_id", postIds);
      await supabaseAdmin.from("post_tags").delete().in("post_id", postIds);
      await supabaseAdmin.from("post_confirmations").delete().in("post_id", postIds);
      await supabaseAdmin.from("comments").delete().in("post_id", postIds);
    }

    // 2. Delete user's own confirmations on other posts
    await supabaseAdmin.from("post_confirmations").delete().eq("user_id", userId);

    // 3. Delete user's comments on other posts
    await supabaseAdmin.from("comments").delete().eq("user_id", userId);

    // 4. Delete user's posts
    await supabaseAdmin.from("posts").delete().eq("user_id", userId);

    // 5. Delete notifications
    await supabaseAdmin.from("notifications").delete().eq("user_id", userId);

    // 6. Delete emergency contacts
    await supabaseAdmin.from("emergency_contacts").delete().eq("user_id", userId);

    // 7. Delete user settings
    await supabaseAdmin.from("user_settings").delete().eq("user_id", userId);

     // 8. Delete SOS alerts if table exists
    try {
      await supabaseAdmin.from("sos_alerts").delete().eq("user_id", userId);
    } catch {
      // Table may not exist, ignore
    }

    // 9. Delete guardian applications if table exists
    try {
      await supabaseAdmin.from("guardian_applications").delete().eq("user_id", userId);
    } catch {
      // Table may not exist, ignore
    }

    // 10. Delete the user record from users table
    const { error: userDeleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", userId);

    if (userDeleteError) {
      console.error("Error deleting user record:", userDeleteError);
      return NextResponse.json(
        { error: "Failed to delete user record" },
        { status: 500 }
      );
    }

    // 11. Finally, delete the Auth user
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authDeleteError) {
      console.error("Error deleting auth user:", authDeleteError);
      // User data is already deleted, so we still return success
      // The auth user will be orphaned but that's better than failing
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Delete account error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete account" },
      { status: 500 }
    );
  }
}