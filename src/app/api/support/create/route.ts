import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";

export const runtime = "nodejs";

const TITLE_MAX = 120;
const MESSAGE_MAX = 4000;

function makeTicketNumber() {
  // PEJA-<base36 from timestamp>-<random 4 chars>. Short, human-readable, low-collision.
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PEJA-${stamp}-${rand}`;
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const body = await req.json();
    const title = String(body?.title ?? "").trim();
    const message = String(body?.message ?? "").trim();

    if (!title) return NextResponse.json({ ok: false, error: "Title is required" }, { status: 400 });
    if (!message) return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
    if (title.length > TITLE_MAX) {
      return NextResponse.json({ ok: false, error: `Title too long (max ${TITLE_MAX})` }, { status: 400 });
    }
    // Throttle ticket creation so the support inbox can't be flooded.
    if (await isRateLimitedDurable(`support-create:${user.id}`, 5, 10 * 60)) {
      return NextResponse.json({ ok: false, error: "Too many requests. Please try again shortly." }, { status: 429 });
    }
    if (message.length > MESSAGE_MAX) {
      return NextResponse.json({ ok: false, error: `Message too long (max ${MESSAGE_MAX})` }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const ticketNumber = makeTicketNumber();

    const { data: ticket, error } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        ticket_number: ticketNumber,
        user_id: user.id,
        title,
        message,
        status: "open",
      })
      .select("id, ticket_number, status, created_at")
      .single();

    if (error) throw error;

    // Look up the user's display name/email so the email body can attribute it.
    const { data: profile } = await supabaseAdmin
      .from("users")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    const userEmail = profile?.email || user.email || null;
    const userName = profile?.full_name || userEmail?.split("@")[0] || "Peja user";

    // Fire-and-forget email to the support inbox via the same Apps Script pipe
    // used by SOS alerts. Template: "support".
    const scriptUrl = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
    const supportInbox = process.env.PEJA_SUPPORT_INBOX || "pejastudios@gmail.com";
    if (scriptUrl) {
      fetch(scriptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Peja-Secret": process.env.APPS_SCRIPT_WEBHOOK_SECRET || "",
        },
        body: JSON.stringify({
          secret: process.env.APPS_SCRIPT_WEBHOOK_SECRET || "",
          template: "support",
          recipients: [{ email: supportInbox, name: "Peja Support" }],
          payload: {
            kind: "user_reply",
            ticket_id: ticket.id,
            ticket_number: ticket.ticket_number,
            title,
            message,
            user_id: user.id,
            user_email: userEmail,
            user_name: userName,
            created_at: ticket.created_at,
          },
        }),
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      ticket: {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        status: ticket.status,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const status = /token|Invalid user/i.test(msg) ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
