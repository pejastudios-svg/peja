// Outbound email via the Apps Script webhook (same channel the password
// flows use). Kept deliberately dependency-free so it still works when
// other parts of the system are unhealthy.
//
// Env (never hardcode):
//   APPS_SCRIPT_EMAIL_WEBHOOK_URL   required
//   APPS_SCRIPT_WEBHOOK_SECRET      shared secret checked by the script
//   OPS_ALERT_EMAIL                 optional override for ops alerts;
//                                   defaults to the admin account's email

import { getSupabaseAdmin } from "./_supabaseAdmin";

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const webhookUrl = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
  if (!webhookUrl || !params.to) return false;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: process.env.APPS_SCRIPT_WEBHOOK_SECRET,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });
    return true;
  } catch (e) {
    console.error("[email] send failed:", e);
    return false;
  }
}

/**
 * Operational alert to whoever runs peja. Email on purpose: an in-app
 * notification is useless for telling you the app is broken, since it
 * relies on the very system that may be down, and only lands when you
 * happen to open peja.
 */
export async function sendOpsAlert(subject: string, message: string): Promise<boolean> {
  let to = process.env.OPS_ALERT_EMAIL || "";
  if (!to) {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data: admin } = await supabaseAdmin
        .from("users")
        .select("email")
        .eq("is_admin", true)
        .limit(1)
        .maybeSingle();
      to = (admin?.email as string) || "";
    } catch {
      return false;
    }
  }
  if (!to) return false;

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#b91c1c,#ef4444);color:#fff;padding:20px;border-radius:12px 12px 0 0">
    <h1 style="margin:0;font-size:20px">${subject}</h1>
    <p style="margin:4px 0 0;opacity:.9;font-size:13px">peja system alert</p>
  </div>
  <div style="background:#1a1a2e;color:#e0e0e0;padding:24px;border:1px solid #333">
    <p style="line-height:1.6">${message}</p>
    <p style="margin-top:20px;color:#888;font-size:13px">
      Sent automatically by peja. If this is unexpected, check the cron jobs
      and the Vercel deployment.
    </p>
  </div>
  <div style="background:#111;color:#555;padding:12px;border-radius:0 0 12px 12px;text-align:center;font-size:11px">
    PEJA STUDIOS LIMITED
  </div>
</div>`;

  return sendEmail({ to, subject: `[peja] ${subject}`, html });
}
