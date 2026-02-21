import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAdmin(req);
    const { applicationId, action } = await req.json();

    if (!applicationId || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // fetch application
    const { data: app, error: appErr } = await supabaseAdmin
      .from("guardian_applications")
      .select("id,user_id,status")
      .eq("id", applicationId)
      .single();

    if (appErr || !app) {
      return NextResponse.json({ ok: false, error: "Application not found" }, { status: 404 });
    }

    const newStatus = action === "approve" ? "approved" : "rejected";

    // update application
    const { error: updErr } = await supabaseAdmin
      .from("guardian_applications")
      .update({
        status: newStatus,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", applicationId);

    if (updErr) throw updErr;

    // If approved, grant guardian
    if (action === "approve") {
      const { error: roleErr } = await supabaseAdmin
        .from("users")
        .update({ is_guardian: true })
        .eq("id", app.user_id);

      if (roleErr) throw roleErr;
    }

    // Send user notification in the NORMAL notifications table
    // (this is for the applicant, not admin/guardian dashboards)
    const title =
      action === "approve" ? "✅ Guardian application approved" : "Guardian application update";
    const body =
      action === "approve"
        ? "Thank you for volunteering. You now have access to the Guardian Hub."
        : "Thank you for applying. We can’t approve you right now, but we appreciate your willingness to help. You can apply again later.";

    const { error: notifErr } = await supabaseAdmin.from("notifications").insert({
      user_id: app.user_id,
      type: action === "approve" ? "guardian_approved" : "guardian_rejected",
      title,
      body,
      data: { application_id: applicationId },
      is_read: false,
    });

    if (notifErr) console.warn("Failed to create applicant notification:", notifErr);

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}