import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { postId, reason, description } = await req.json();

    if (!postId || !reason) {
      return NextResponse.json({ ok: false, error: "Missing postId or reason" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1) Insert report (ignore duplicates if unique constraint exists)
    const { error: reportErr } = await supabaseAdmin.from("post_reports").insert({
      post_id: postId,
      user_id: user.id,
      reason,
      description: description || null,
    });

    if (reportErr && (reportErr as any).code !== "23505") {
      return NextResponse.json({ ok: false, error: reportErr.message }, { status: 400 });
    }

    // 2) Ensure a pending flagged_content row exists (insert-only)
    const { error: flagErr } = await supabaseAdmin.from("flagged_content").upsert(
      {
        post_id: postId,
        reason,
        source: "user",
        priority: "medium",
        status: "pending",
      },
      { onConflict: "post_id", ignoreDuplicates: true }
    );

    if (flagErr) {
      return NextResponse.json({ ok: false, error: flagErr.message }, { status: 400 });
    }

    // 3) Compute true report count from post_reports (authoritative)
    const { count: reportCount, error: countErr } = await supabaseAdmin
      .from("post_reports")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId);

    if (countErr) {
      return NextResponse.json({ ok: false, error: countErr.message }, { status: 400 });
    }

    const rc = reportCount || 0;

    // 4) Update report_count + auto archive if >=3
    const newStatus = rc >= 3 ? "archived" : undefined;

    const patch: any = { report_count: rc };
    if (newStatus) patch.status = "archived";

    const { error: postUpdErr } = await supabaseAdmin.from("posts").update(patch).eq("id", postId);
    if (postUpdErr) {
      return NextResponse.json({ ok: false, error: postUpdErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, reportCount: rc, archived: rc >= 3 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}