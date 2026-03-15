import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { contactId, accept } = await req.json();


    if (!contactId || typeof accept !== "boolean") {
      return NextResponse.json({ ok: false, error: "Missing contactId or accept" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Find the emergency contact
    const { data: contact, error: fetchErr } = await supabaseAdmin
      .from("emergency_contacts")
      .select("id, user_id, contact_user_id, status, relationship")
      .eq("id", contactId)
      .single();


    if (fetchErr || !contact) {
      return NextResponse.json(
        { ok: false, error: "This request no longer exists. It may have been deleted." },
        { status: 404 }
      );
    }

    if (contact.contact_user_id !== user.id) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    if (contact.status !== "pending") {
      return NextResponse.json(
        { ok: false, error: `Already ${contact.status}`, status: contact.status },
        { status: 409 }
      );
    }

    // Update status
    const newStatus = accept ? "accepted" : "declined";
    const { error: updateErr } = await supabaseAdmin
      .from("emergency_contacts")
      .update({ status: newStatus })
      .eq("id", contactId);

    if (updateErr) {
      console.error("[respond-emergency-contact] update error:", updateErr);
      return NextResponse.json({ ok: false, error: "Failed to update" }, { status: 500 });
    }


    // Get responder name
    const { data: currentUser } = await supabaseAdmin
      .from("users")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .single();

    const responderName = currentUser?.full_name || "Someone";
    const responderAvatar = currentUser?.avatar_url || null;

    // Notify the requester
    await supabaseAdmin.from("notifications").insert({
      user_id: contact.user_id,
      type: "system",
      title: accept ? "Emergency Contact Accepted" : "Emergency Contact Declined",
      body: accept
        ? `${responderName} accepted your emergency contact request.`
        : `${responderName} declined your emergency contact request.`,
      data: {
        type: "emergency_contact_response",
        accepted: accept,
        responder_name: responderName,
        responder_avatar: responderAvatar,
      },
      is_read: false,
    });

    return NextResponse.json({ ok: true, status: newStatus });
  } catch (e: any) {
    console.error("[respond-emergency-contact] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}