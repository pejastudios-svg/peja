import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { postId } = await req.json();
    if (!postId) {
      return NextResponse.json({ ok: false, error: "Missing postId" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Prefer ON DELETE CASCADE later, but keep as-is for now.
    await supabaseAdmin.from("post_comments").delete().eq("post_id", postId);
    await supabaseAdmin.from("post_media").delete().eq("post_id", postId);
    await supabaseAdmin.from("post_tags").delete().eq("post_id", postId);
    await supabaseAdmin.from("post_confirmations").delete().eq("post_id", postId);
    await supabaseAdmin.from("post_reports").delete().eq("post_id", postId);
    await supabaseAdmin.from("flagged_content").delete().eq("post_id", postId);

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