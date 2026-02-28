import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";
import { isRateLimited } from "../_rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);

    const { postId } = await req.json();
    if (!postId) {
      return NextResponse.json({ ok: false, error: "Missing postId" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify the user owns this post
    const { data: post, error: postErr } = await supabaseAdmin
      .from("posts")
      .select("id, user_id")
      .eq("id", postId)
      .single();

    if (postErr || !post) {
      return NextResponse.json({ ok: false, error: "Post not found" }, { status: 404 });
    }

    if (post.user_id !== user.id) {
      return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
    }

    // Delete related data
    await supabaseAdmin.from("post_comments").delete().eq("post_id", postId);
    await supabaseAdmin.from("post_media").delete().eq("post_id", postId);
    await supabaseAdmin.from("post_tags").delete().eq("post_id", postId);
    await supabaseAdmin.from("post_confirmations").delete().eq("post_id", postId);
    await supabaseAdmin.from("post_reports").delete().eq("post_id", postId);
    await supabaseAdmin.from("flagged_content").delete().eq("post_id", postId);

    // Delete the post
    const { error } = await supabaseAdmin.from("posts").delete().eq("id", postId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}