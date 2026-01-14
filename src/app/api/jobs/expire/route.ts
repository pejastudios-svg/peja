import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireUser(req);

    const supabaseAdmin = getSupabaseAdmin();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Posts: live -> resolved after 24h
    const { error: postsErr } = await supabaseAdmin
      .from("posts")
      .update({ status: "resolved" })
      .eq("status", "live")
      .lt("created_at", cutoff);

    if (postsErr) throw postsErr;

    // SOS: active -> resolved after 24h
    const { error: sosErr } = await supabaseAdmin
      .from("sos_alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("status", "active")
      .lt("created_at", cutoff);

    if (sosErr) throw sosErr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}