// src/app/api/admin/intruder-alert/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const ua = req.headers.get("user-agent") || "unknown";
  const supabaseAdmin = getSupabaseAdmin();

  // ── simple DB-based rate limit (max 3 per 30 s per IP) ──
  const thirtyAgo = new Date(Date.now() - 30_000).toISOString();
  const { count } = await supabaseAdmin
    .from("admin_access_log")
    .select("*", { count: "exact", head: true })
    .eq("action", "intruder_alert_sent")
    .eq("ip_address", ip)
    .gte("created_at", thirtyAgo);

  if ((count || 0) >= 3) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const { photo, userId, userEmail, userName } = await req.json();

  // ── upload photo to Cloudinary (signed, server-side) ──
  let photoUrl: string | null = null;

  if (photo) {
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (cloudName && apiKey && apiSecret) {
      try {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const folder = "peja-intruder-alerts";
        const sig = crypto
          .createHash("sha1")
          .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
          .digest("hex");

        const form = new FormData();
        form.append("file", photo);
        form.append("folder", folder);
        form.append("timestamp", timestamp);
        form.append("api_key", apiKey);
        form.append("signature", sig);

        const up = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
          { method: "POST", body: form }
        );
        if (up.ok) {
          const d = await up.json();
          photoUrl = d.secure_url || null;
        }
      } catch (e) {
        console.error("Cloudinary upload failed:", e);
      }
    }
  }

  // ── IP geolocation ──
  let geo = "Unknown";
  try {
    const g = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp`
    );
    if (g.ok) {
      const d = await g.json();
      if (d.status === "success")
        geo = `${d.city}, ${d.regionName}, ${d.country} (${d.isp})`;
    }
  } catch {}

  // ── log to DB ──
  await supabaseAdmin.from("admin_access_log").insert({
    user_id: userId || null,
    action: "intruder_alert_sent",
    ip_address: ip,
    user_agent: ua,
    metadata: { photo_url: photoUrl, geo, user_email: userEmail, user_name: userName },
  });

  // ── send email ──
  const alertEmail = process.env.ADMIN_ALERT_EMAIL;
  const webhookUrl = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
  const webhookSecret = process.env.APPS_SCRIPT_WEBHOOK_SECRET;

  if (alertEmail && webhookUrl) {
    const now = new Date().toLocaleString("en-US", { timeZone: "Africa/Nairobi" });

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#dc2626;color:#fff;padding:20px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="margin:0;font-size:22px">🚨 ADMIN INTRUSION ALERT</h1>
    <p style="margin:4px 0 0;opacity:.9">Failed Admin PIN Attempt</p>
  </div>
  <div style="background:#1a1a2e;color:#e0e0e0;padding:20px;border:1px solid #333">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#888;width:120px">Time</td><td>${now}</td></tr>
      <tr><td style="padding:8px 0;color:#888">IP Address</td><td>${ip}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Location</td><td>${geo}</td></tr>
      <tr><td style="padding:8px 0;color:#888">User</td><td>${userName || "Unknown"} (${userEmail || "N/A"})</td></tr>
      <tr><td style="padding:8px 0;color:#888">User ID</td><td style="font-size:11px">${userId || "N/A"}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Browser</td><td style="font-size:11px">${ua}</td></tr>
    </table>
    ${
      photoUrl
        ? `<h3 style="color:#ff6b6b;margin-top:20px">📸 Captured Photo:</h3>
           <img src="${photoUrl}" style="max-width:100%;border-radius:8px;border:2px solid #ff6b6b" />`
        : `<p style="color:#888;margin-top:20px">📸 Camera was unavailable or denied.</p>`
    }
  </div>
  <div style="background:#111;color:#555;padding:12px;border-radius:0 0 12px 12px;text-align:center;font-size:11px">
    Peja Admin Security System
  </div>
</div>`;

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: webhookSecret,
          to: alertEmail,
          subject: `🚨 INTRUSION ALERT — ${now}`,
          html,
        }),
      });
    } catch (e) {
      console.error("Email send failed:", e);
    }
  }

  return NextResponse.json({ ok: true });
}