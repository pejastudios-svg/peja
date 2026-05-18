import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";

export const runtime = "nodejs";

const VALID_STATUSES = ["open", "in_progress", "resolved", "archived"] as const;
type TicketStatus = typeof VALID_STATUSES[number];

// Statuses we tell the user about. Archiving is purely internal.
const USER_VISIBLE_STATUS_CHANGES = new Set<TicketStatus>(["in_progress", "resolved", "open"]);

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderStatusEmail({
  userName,
  ticketNumber,
  title,
  newStatus,
}: {
  userName: string;
  ticketNumber: string;
  title: string;
  newStatus: string;
}) {
  return `
    <div style="font-family: Arial, sans-serif; background:#0b1020; padding:24px;">
      <div style="max-width:640px; margin:0 auto; background:rgba(30,16,51,0.95); border:1px solid rgba(139,92,246,0.35); border-radius:16px; padding:22px; color:#f8fafc;">
        <p style="margin:0 0 6px 0; font-size:13px; color:#94a3b8;">Peja Support</p>
        <h2 style="margin:0 0 14px 0; font-size:18px;">Your ticket has been updated</h2>
        <p style="margin:0 0 10px 0;">Hi ${escapeHtml(userName)},</p>
        <p style="margin:0 0 6px 0;"><b>Re:</b> ${escapeHtml(title)}</p>
        <p style="margin:0; font-family:Menlo,Consolas,monospace; font-size:12px; color:#94a3b8;">Ticket: ${escapeHtml(ticketNumber)}</p>
        <p style="margin:14px 0 0 0;">Your ticket status is now: <b style="color:#a78bfa; text-transform:capitalize;">${escapeHtml(newStatus.replace(/_/g, " "))}</b>.</p>
        <p style="margin-top:20px; font-size:12px; color:#94a3b8;">
          Reply to this email to continue the conversation, or write to
          <a style="color:#a78bfa;" href="mailto:pejastudios@gmail.com">pejastudios@gmail.com</a>.
        </p>
      </div>
    </div>
  `;
}

export async function POST(req: NextRequest) {
  try {
    const { user: adminUser } = await requireAdminSession(req);
    const body = await req.json();
    const ticketId = String(body?.ticketId ?? "").trim();
    const status = body?.status as TicketStatus | undefined;

    if (!ticketId) {
      return NextResponse.json({ ok: false, error: "Missing ticketId" }, { status: 400 });
    }
    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: before, error: beforeErr } = await supabaseAdmin
      .from("support_tickets")
      .select("id, ticket_number, title, user_id, status")
      .eq("id", ticketId)
      .single();
    if (beforeErr || !before) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = { status };
    if (status === "resolved") {
      patch.resolved_at = new Date().toISOString();
      patch.resolved_by = adminUser.id;
    } else if (before.status === "resolved") {
      patch.resolved_at = null;
      patch.resolved_by = null;
    }

    const { data, error } = await supabaseAdmin
      .from("support_tickets")
      .update(patch)
      .eq("id", ticketId)
      .select("id, ticket_number, title, user_id, status, resolved_at, resolved_by, updated_at, admin_notes")
      .single();
    if (error || !data) {
      return NextResponse.json({ ok: false, error: error?.message || "Update failed" }, { status: 500 });
    }

    const statusChanged = status !== before.status;
    let emailSent = false;

    if (statusChanged && USER_VISIBLE_STATUS_CHANGES.has(status)) {
      const { data: u } = await supabaseAdmin
        .from("users")
        .select("email, full_name")
        .eq("id", before.user_id)
        .single();
      const scriptUrl = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
      const webhookSecret = process.env.APPS_SCRIPT_WEBHOOK_SECRET || "";

      if (u?.email && scriptUrl) {
        const userName = u.full_name || u.email.split("@")[0];
        const tn = data.ticket_number || before.ticket_number;
        const html = renderStatusEmail({
          userName,
          ticketNumber: tn,
          title: before.title,
          newStatus: String(status),
        });
        fetch(scriptUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Peja-Secret": webhookSecret,
          },
          body: JSON.stringify({
            secret: webhookSecret,
            template: "custom",
            to: u.email,
            subject: `Update on your Peja support ticket [${tn}]`,
            html,
          }),
        }).catch(() => {});
        emailSent = true;
      }
    }

    return NextResponse.json({ ok: true, ticket: data, emailSent });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const status = /Admin|PIN/i.test(msg) ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
