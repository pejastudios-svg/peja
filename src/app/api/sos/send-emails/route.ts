import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { sosId } = await req.json();

    if (!sosId) return NextResponse.json({ ok: false, error: "Missing sosId" }, { status: 400 });

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
    const { data: nearby } = await supabaseAdmin.rpc("users_within_radius", {
      lat: sos.latitude,
      lng: sos.longitude,
      radius_m: 5000,
      max_results: 200,
    });

    const nearbyIds = (nearby || []).map((r: any) => r.id).filter((id: string) => id && id !== user.id);

    // Merge recipients (contacts first, then nearby) + cap 50
    const mergedIds: string[] = [];
    for (const id of contactIds) if (!mergedIds.includes(id)) mergedIds.push(id);
    for (const id of nearbyIds) if (!mergedIds.includes(id)) mergedIds.push(id);

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