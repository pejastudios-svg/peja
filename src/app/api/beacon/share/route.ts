import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";
import { canUseBeacon } from "@/lib/beacon";

// Who can see this Beacon, person by person.
//
// GET  ?deviceId=...          -> accepted contacts + whether each can see it
// POST { deviceId, contactUserId, visible }
//
// Stored as an EXCLUSION list, so a contact added later is visible by
// default without the owner having to grant anything.

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!canUseBeacon(user.email)) {
      return NextResponse.json({ error: "Beacon is in a closed pilot" }, { status: 403 });
    }
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId required" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id")
      .eq("id", deviceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    const [contactsRes, hiddenRes] = await Promise.all([
      supabaseAdmin
        .from("emergency_contacts")
        .select("contact_user_id")
        .eq("user_id", user.id)
        .eq("status", "accepted")
        .not("contact_user_id", "is", null),
      supabaseAdmin
        .from("device_hidden_contacts")
        .select("contact_user_id")
        .eq("device_id", deviceId),
    ]);

    const ids = [
      ...new Set((contactsRes.data || []).map((c) => c.contact_user_id as string)),
    ].filter(Boolean);
    if (ids.length === 0) return NextResponse.json({ contacts: [] });

    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id, full_name, avatar_url")
      .in("id", ids);

    const hidden = new Set(
      (hiddenRes.data || []).map((h) => h.contact_user_id as string),
    );

    return NextResponse.json({
      contacts: (users || []).map((u) => ({
        id: u.id,
        name: u.full_name || "Unknown",
        avatar: u.avatar_url || null,
        visible: !hidden.has(u.id),
      })),
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not load sharing" }, { status: 500 })
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!canUseBeacon(user.email)) {
      return NextResponse.json({ error: "Beacon is in a closed pilot" }, { status: 403 });
    }

    const { deviceId, contactUserId, visible } = await req.json();
    if (!deviceId || !contactUserId || typeof visible !== "boolean") {
      return NextResponse.json(
        { error: "deviceId, contactUserId and visible required" },
        { status: 400 },
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id")
      .eq("id", deviceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    // Only an accepted contact can be listed either way.
    const { data: rel } = await supabaseAdmin
      .from("emergency_contacts")
      .select("id")
      .eq("user_id", user.id)
      .eq("contact_user_id", contactUserId)
      .eq("status", "accepted")
      .maybeSingle();
    if (!rel) {
      return NextResponse.json({ error: "Not one of your contacts" }, { status: 400 });
    }

    if (visible) {
      await supabaseAdmin
        .from("device_hidden_contacts")
        .delete()
        .eq("device_id", deviceId)
        .eq("contact_user_id", contactUserId);
    } else {
      await supabaseAdmin
        .from("device_hidden_contacts")
        .upsert(
          { device_id: deviceId, contact_user_id: contactUserId },
          { onConflict: "device_id,contact_user_id" },
        );
    }

    return NextResponse.json({ ok: true, visible });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not update sharing" }, { status: 500 })
    );
  }
}
