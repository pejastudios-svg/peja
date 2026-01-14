import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

const ALLOWED = ["approve", "blur", "remove", "escalate"] as const;
type Action = (typeof ALLOWED)[number];

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAdmin(req);

    const { flaggedId, action } = await req.json();

    if (!flaggedId || !ALLOWED.includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // fetch flagged row to get post_id
    const { data: flagged, error: flagErr } = await supabaseAdmin
      .from("flagged_content")
      .select("id, post_id")
      .eq("id", flaggedId)
      .single();

    if (flagErr || !flagged) {
      return NextResponse.json({ ok: false, error: "Flag not found" }, { status: 404 });
    }

    const newStatus =
      action === "approve" ? "approved" :
      action === "escalate" ? "escalated" :
      "removed";

    // Update flagged content status
    const { error: updFlagErr } = await supabaseAdmin
      .from("flagged_content")
      .update({
        status: newStatus,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", flaggedId);

    if (updFlagErr) throw updFlagErr;

    // Apply post changes
    if (flagged.post_id) {
      if (action === "remove") {
        await supabaseAdmin.from("posts").update({ status: "archived" }).eq("id", flagged.post_id);
      }

      if (action === "blur") {
        await supabaseAdmin.from("posts").update({ is_sensitive: true }).eq("id", flagged.post_id);
        await supabaseAdmin.from("post_media").update({ is_sensitive: true }).eq("post_id", flagged.post_id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}