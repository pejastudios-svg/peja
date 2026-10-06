import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";

export const runtime = "nodejs";

/**
 * SOS email fan-out, gated.
 *
 * This route is by far the heaviest consumer of the daily Gmail quota:
 * one SOS mails emergency contacts PLUS everyone within 5km, capped at
 * 50 recipients. On a consumer Gmail account the whole app shares 100
 * sends a day, so two or three alerts can exhaust it and silently take
 * password resets and signup codes down with them.
 *
 * Push notifications and in-app alerts are unaffected by this setting.
 * Email was always the secondary channel here.
 *
 *   SOS_EMAIL_MODE=off        no emails (default)
 *   SOS_EMAIL_MODE=contacts   accepted emergency contacts only
 *   SOS_EMAIL_MODE=all        contacts plus nearby users (previous behaviour)
 */
const SOS_EMAIL_MODE = (process.env.SOS_EMAIL_MODE || "off").toLowerCase();

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { sosId } = await req.json();

    if (!sosId) return NextResponse.json({ ok: false, error: "Missing sosId" }, { status: 400 });

    // Paused. Reported as ok so the SOS flow and the offline outbox do not
    // treat a deliberate setting as a delivery failure and keep retrying.
    if (SOS_EMAIL_MODE === "off") {
      return NextResponse.json({ ok: true, sent: 0, skipped: "sos_email_disabled" });
    }

    // Throttle the email fan-out so a caller can't spam nearby users. Generous
    // enough for legitimate re-sends of a real SOS. Fails open if the limiter
    // backend isn't available.
    if (await isRateLimitedDurable(`sos-emails:${user.id}`, 5, 10 * 60)) {
      return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify SOS belongs to requester
    const { data: sos, error: sosErr } = await supabaseAdmin
      .from("sos_alerts")
      .select("id,user_id,latitude,longitude,address,tag,message,created_at,status")
      .eq("id", sosId)
      .single();

    if (sosErr || !sos) return NextResponse.json({ ok: false, error: "SOS not found" }, { status: 404 });
    if (sos.user_id !== user.id) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // Get the SOS user's name
    const { data: sosUser } = await supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .single();

    const userName = sosUser?.full_name || user.email?.split("@")[0] || "Someone";

    const scriptUrl = process.env.APPS_SCRIPT_EMAIL_WEBHOOK_URL;
    if (!scriptUrl) return NextResponse.json({ ok: false, error: "Missing APPS_SCRIPT_EMAIL_WEBHOOK_URL" }, { status: 500 });

    // Emergency contacts (Peja users)
    const { data: contacts } = await supabaseAdmin
      .from("emergency_contacts")
      .select("contact_user_id")
      .eq("user_id", user.id)
      .eq("status", "accepted");

    const contactIds = (contacts || []).map((c: any) => c.contact_user_id).filter(Boolean);

    // Nearby users (same as in-app)
    // Only worth asking in "all" mode; the radius scan is the expensive
    // part of this route and contacts mode never uses the answer.
    const nearbyIds: string[] =
      SOS_EMAIL_MODE === "all"
        ? ((
            await supabaseAdmin.rpc("users_within_radius", {
              lat: sos.latitude,
              lng: sos.longitude,
              radius_m: 5000,
              max_results: 200,
            })
          ).data || [])
            .map((r: any) => r.id)
            .filter((id: string) => id && id !== user.id)
        : [];

    // Merge recipients (contacts first, then nearby) + cap 50
    const mergedIds: string[] = [];
    for (const id of contactIds) if (!mergedIds.includes(id)) mergedIds.push(id);
    // "contacts" mode stops here: the people who actually agreed to be
    // called in an emergency, not every stranger in a 5km circle.
    if (SOS_EMAIL_MODE === "all") {
      for (const id of nearbyIds) if (!mergedIds.includes(id)) mergedIds.push(id);
    }

    const cappedIds = mergedIds.slice(0, 50);

    // Fetch recipient emails
    const { data: recUsers } = cappedIds.length
      ? await supabaseAdmin
          .from("users")
          .select("id,email,full_name,status")
          .in("id", cappedIds)
      : { data: [] as any[] };

    const recipients = (recUsers || [])
      .filter((u: any) => u.email && u.status === "active")
      .map((u: any) => ({ email: u.email, name: u.full_name || "Peja user" }));

    if (recipients.length === 0) return NextResponse.json({ ok: true, sent: 0 });

    // Send one batch to Apps Script. This is the emergency-email channel, so
    // we must NOT report success blindly: if the webhook is down or errors,
    // the caller (and the offline outbox) needs to know delivery failed.
    const emailRes = await fetch(scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Peja-Secret": process.env.APPS_SCRIPT_WEBHOOK_SECRET || "",
      },
      body: JSON.stringify({
        secret: process.env.APPS_SCRIPT_WEBHOOK_SECRET || "",
        template: "sos",
        recipients,
        payload: {
          sos_id: sos.id,
          tag: sos.tag || null,
          message: sos.message || null,
          address: sos.address || null,
          latitude: sos.latitude,
          longitude: sos.longitude,
          created_at: sos.created_at,
          user_name: userName,
        },
      }),
    });

    if (!emailRes.ok) {
      console.error("[sos/send-emails] webhook returned", emailRes.status);
      return NextResponse.json(
        { ok: false, error: "Email delivery failed", sent: 0 },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, sent: recipients.length });
  } catch (e: any) {
    console.error("[sos/send-emails] failed", e);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}