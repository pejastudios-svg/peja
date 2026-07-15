// Termii SMS client (server-only). Used to send Beacon provisioning
// commands to the tracker's SIM instead of the pilot's manual texting.
//
// Env (never hardcode):
//   TERMII_API_KEY    required; from the Termii dashboard (Settings)
//   TERMII_SENDER_ID  optional; default "N-Alert" (Termii's shared
//                     transactional sender, works without registration)
//   TERMII_CHANNEL    optional; default "dnd" so commands reach the many
//                     Nigerian SIMs with Do-Not-Disturb enabled
//   TERMII_BASE_URL   account-specific host from the dashboard Overview
//                     (e.g. https://v4.api.termii.com); default v3

import { getSupabaseAdmin } from "./_supabaseAdmin";
import { sendPushToUser } from "./_firebaseAdmin";

const BASE = () =>
  (process.env.TERMII_BASE_URL || "https://v3.api.termii.com").replace(/\/+$/, "");

export function termiiConfigured(): boolean {
  return Boolean(process.env.TERMII_API_KEY);
}

/** Local Nigerian forms (0801..., +234801...) -> Termii's 234801... */
export function toIntlMsisdn(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return "234" + digits.slice(1);
  return digits;
}

export interface TermiiSendResult {
  ok: boolean;
  messageId?: string;
  /** Wallet balance after the send, when Termii reports it. */
  balance?: number;
  error?: string;
}

export async function sendTermiiSms(to: string, body: string): Promise<TermiiSendResult> {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) return { ok: false, error: "TERMII_API_KEY is not set" };

  try {
    const res = await fetch(`${BASE()}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        to: toIntlMsisdn(to),
        from: process.env.TERMII_SENDER_ID || "N-Alert",
        sms: body,
        type: "plain",
        channel: process.env.TERMII_CHANNEL || "dnd",
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.message_id) {
      return {
        ok: false,
        error:
          (typeof data?.message === "string" && data.message) ||
          `Termii rejected the send (${res.status})`,
      };
    }
    return {
      ok: true,
      messageId: String(data.message_id),
      balance: typeof data.balance === "number" ? data.balance : Number(data.balance) || undefined,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function termiiBalance(): Promise<number | null> {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${BASE()}/api/get-balance?api_key=${encodeURIComponent(apiKey)}`);
    const data = await res.json().catch(() => null);
    const b = Number(data?.balance);
    return Number.isFinite(b) ? b : null;
  } catch {
    return null;
  }
}

/**
 * Wallet balance is business-internal: never sent to clients. Below the
 * threshold the ADMIN account gets a durable notification + push, at most
 * once per 24h regardless of how many commands go out.
 */
export async function notifyAdminIfBalanceLow(balance: number | null | undefined) {
  if (balance == null || balance >= 100) return;
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: admin } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("is_admin", true)
      .limit(1)
      .maybeSingle();
    if (!admin) return;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("user_id", admin.id)
      .eq("data->>type", "termii_low_balance")
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) return;

    const title = "Termii balance low";
    const body = `The SMS wallet is down to about NGN ${Math.round(balance)}. Top up or Beacon pairing will start failing.`;
    await supabaseAdmin.from("notifications").insert({
      user_id: admin.id,
      type: "system",
      title,
      body,
      data: { type: "termii_low_balance", balance: Math.round(balance) },
      is_read: false,
    });
    sendPushToUser({ userId: admin.id, title, body, data: { type: "termii_low_balance" } }).catch(() => {});
  } catch {
    // Alerting must never break a send.
  }
}
