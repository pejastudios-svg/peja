import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const { contactId } = await req.json();

    if (!contactId) {
      return NextResponse.json({ ok: false, error: "Missing contactId" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Verify this contact belongs to the user (either as requester or contact)
    const { data: contact, error: fetchErr } = await supabaseAdmin
      .from("emergency_contacts")
      .select("id, user_id, contact_user_id")
      .eq("id", contactId)
      .single();

    if (fetchErr || !contact) {
      return NextResponse.json({ ok: false, error: "Contact not found" }, { status: 404 });
    }

    // Allow deletion if user is the requester OR the contact person
    if (contact.user_id !== user.id && contact.contact_user_id !== user.id) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Delete the row completely
    const { error: deleteErr } = await supabaseAdmin
      .from("emergency_contacts")
      .delete()
      .eq("id", contactId);

    if (deleteErr) {
      console.error("[delete-emergency-contact] error:", deleteErr);
      return NextResponse.json({ ok: false, error: "Failed to delete" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[delete-emergency-contact] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}