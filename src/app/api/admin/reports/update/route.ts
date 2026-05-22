import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";

export const runtime = "nodejs";

// Update a single user_reports row from the admin queue. Used to
// mark a report as 'dismissed' (no action taken) or 'actioned'
// (after the admin suspended / banned / revoked VIP for the
// reported user). The actual account-state change is done by
// the dedicated endpoints (set-user-status, set-vip-status) —
// THIS endpoint only stamps the report itself with the outcome.
//
// Body:
//   • reportId    — uuid of the user_reports row
//   • status      — "dismissed" | "actioned"
//   • adminNotes  — optional free-form note (audit trail)
//   • actionTaken — optional human-readable summary
//                   ("Suspended 7d", "Banned", "VIP revoked")

export async function POST(req: NextRequest) {
  try {
    const { user: adminUser } = await requireAdminSession(req);
    const body = await req.json();
    const reportId = String(body.reportId || "");
    const status = String(body.status || "");
    const adminNotes = body.adminNotes ? String(body.adminNotes).slice(0, 2000) : null;
    const actionTaken = body.actionTaken ? String(body.actionTaken).slice(0, 200) : null;

    if (!reportId) {
      return NextResponse.json(
        { ok: false, error: "Missing reportId" },
        { status: 400 }
      );
    }
    if (!["dismissed", "actioned"].includes(status)) {
      return NextResponse.json(
        { ok: false, error: "Invalid status" },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("user_reports")
      .update({
        status,
        admin_notes: adminNotes,
        action_taken: actionTaken,
        reviewed_by: adminUser.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reportId)
      .select("id, status, admin_notes, action_taken, reviewed_by, reviewed_at")
      .single();
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, report: data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Server error";
    const unauth = msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("admin");
    return NextResponse.json(
      { ok: false, error: msg },
      { status: unauth ? 403 : 500 }
    );
  }
}
