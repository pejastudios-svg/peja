import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";

export const runtime = "nodejs";

// Admin inbox for user reports. Returns rows from `user_reports`
// joined with the reporter + reported user summaries (so the UI
// doesn't have to fan out N queries) plus the current account
// status of the reported user (active / suspended / banned, VIP).
//
// Query params:
//   • status — optional filter, one of "pending" / "dismissed" /
//     "actioned". Defaults to "pending" (the inbox view).
//   • limit  — optional cap, default 100, max 500.

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);

    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status") || "pending";
    if (!["pending", "dismissed", "actioned", "all"].includes(statusParam)) {
      return NextResponse.json(
        { ok: false, error: "Invalid status" },
        { status: 400 }
      );
    }
    const limitRaw = parseInt(url.searchParams.get("limit") || "100", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(500, Math.max(1, limitRaw))
      : 100;

    const supabaseAdmin = getSupabaseAdmin();

    let query = supabaseAdmin
      .from("user_reports")
      .select(
        `
          id, reporter_id, reported_id, conversation_id, reason, notes,
          status, admin_notes, action_taken, reviewed_by, reviewed_at,
          created_at,
          reporter:reporter_id ( id, full_name, avatar_url ),
          reported:reported_id ( id, full_name, avatar_url, is_vip, is_mvp, status )
        `
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (statusParam !== "all") {
      query = query.eq("status", statusParam);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, reports: data ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    const unauth = msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("admin");
    return NextResponse.json(
      { ok: false, error: msg },
      { status: unauth ? 403 : 500 }
    );
  }
}
