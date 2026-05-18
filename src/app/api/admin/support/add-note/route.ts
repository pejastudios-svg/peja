import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAdminSession } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";

export const runtime = "nodejs";

const BODY_MAX = 4000;

interface AdminNote {
  id: string;
  kind: "note" | "reply";
  body: string;
  author_id: string;
  created_at: string;
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderReplyEmail({
  userName,
  ticketNumber,
  title,
  body,
}: {
  userName: string;
  ticketNumber: string;
  title: string;
  body: string;
}) {
  return `
    <div style="font-family: Arial, sans-serif; background:#0b1020; padding:24px;">
      <div style="max-width:640px; margin:0 auto; background:rgba(30,16,51,0.95); border:1px solid rgba(139,92,246,0.35); border-radius:16px; padding:22px; color:#f8fafc;">
        <p style="margin:0 0 6px 0; font-size:13px; color:#94a3b8;">Peja Support</p>
        <h2 style="margin:0 0 14px 0; font-size:18px;">Reply from the Peja team</h2>
        <p style="margin:0 0 10px 0;">Hi ${escapeHtml(userName)},</p>
        <p style="margin:0 0 6px 0;"><b>Re:</b> ${escapeHtml(title)}</p>
        <p style="margin:0; font-family:Menlo,Consolas,monospace; font-size:12px; color:#94a3b8;">Ticket: ${escapeHtml(ticketNumber)}</p>
        <div style="margin-top:14px; padding:14px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:10px; white-space:pre-wrap; word-wrap:break-word; color:#e2e8f0;">
          ${escapeHtml(body)}
        </div>
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
    const text = String(body?.body ?? "").trim();
    const sendEmail = Boolean(body?.sendEmail);

    if (!ticketId) return NextResponse.json({ ok: false, error: "Missing ticketId" }, { status: 400 });
    if (!text) return NextResponse.json({ ok: false, error: "Note body required" }, { status: 400 });
    if (text.length > BODY_MAX) {
      return NextResponse.json({ ok: false, error: `Note too long (max ${BODY_MAX})` }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: before, error: beforeErr } = await supabaseAdmin
      .from("support_tickets")
      .select("id, ticket_number, title, user_id, admin_notes")
      .eq("id", ticketId)
      .single();
    if (beforeErr || !before) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    const existing: AdminNote[] = Array.isArray(before.admin_notes) ? before.admin_notes : [];
    const note: AdminNote = {
      id: randomUUID(),
      kind: sendEmail ? "reply" : "note",
      body: text,
      author_id: adminUser.id,
      created_at: new Date().toISOString(),
    };
    const nextNotes = [...existing, note];

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("support_tickets")
      .update({ admin_notes: nextNotes })
      .eq("id", ticketId)
      .select("id, ticket_number, admin_notes, updated_at")
      .single();
    if (updateErr || !updated) {
      return NextResponse.json({ ok: false, error: updateErr?.message || "Update failed" }, { status: 500 });
    }

    let emailSent = false;
    if (sendEmail) {
      const { data: u } = await supabaseAdmin
        .from("users")
        .select("email, full_name")
        .eq("id", before.user_id)
        .single();
      const scriptUrl = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
      const webhookSecret = process.env.APPS_SCRIPT_WEBHOOK_SECRET || "";

      if (u?.email && scriptUrl) {
        const userName = u.full_name || u.email.split("@")[0];
        const tn = updated.ticket_number || before.ticket_number;
        const html = renderReplyEmail({
          userName,
          ticketNumber: tn,
          title: before.title,
          body: text,
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
            subject: `Re: ${before.title} [${tn}]`,
            html,
          }),
        }).catch(() => {});
        emailSent = true;
      }
    }

    return NextResponse.json({ ok: true, note, admin_notes: nextNotes, emailSent });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const status = /Admin|PIN/i.test(msg) ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
