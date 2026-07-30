import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";

// How many people were actually alerted for an SOS.
//
// Why this exists: the count cannot be read from the client. RLS lets a
// user select only THEIR OWN notification rows, and the alert rows belong
// to the contacts who were notified, so a client-side count always returns
// zero. That is why a Beacon-triggered SOS (fan-out happens server-side,
// on another device entirely) displayed "0 people notified" while people
// were in fact notified.
//
// Ownership is verified before counting, so a user can only ask about
// their own alert.
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const sosId = req.nextUrl.searchParams.get("sosId");
    if (!sosId) {
      return NextResponse.json({ error: "sosId required" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: alert } = await supabaseAdmin
      .from("sos_alerts")
      .select("id, user_id")
      .eq("id", sosId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!alert) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Everyone who received an alert row for this SOS.
    const { data: rows } = await supabaseAdmin
      .from("notifications")
      .select("user_id")
      .eq("type", "sos_alert")
      .eq("data->>sos_id", sosId);

    const recipients = [
      ...new Set((rows || []).map((r) => r.user_id as string)),
    ].filter((id) => id && id !== user.id);

    // Split contacts vs nearby responders so the UI can say which is which.
    const { data: contacts } = await supabaseAdmin
      .from("emergency_contacts")
      .select("contact_user_id")
      .eq("user_id", user.id)
      .eq("status", "accepted")
      .not("contact_user_id", "is", null);
    const contactSet = new Set(
      (contacts || []).map((c) => c.contact_user_id as string),
    );

    const contactCount = recipients.filter((id) => contactSet.has(id)).length;
    const nearbyCount = recipients.length - contactCount;

    return NextResponse.json({ contacts: contactCount, nearby: nearbyCount });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not read the count" }, { status: 500 })
    );
  }
}
