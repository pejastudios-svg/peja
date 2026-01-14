import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Missing userId" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1) fetch emergency contact rows
    const { data: rows, error: ecErr } = await supabaseAdmin
      .from("emergency_contacts")
      .select("id,user_id,contact_user_id,relationship,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (ecErr) throw ecErr;

    const contactIds = Array.from(
      new Set((rows || []).map((r: any) => r.contact_user_id).filter(Boolean))
    );

    // 2) fetch contact user details
    const { data: users, error: uErr } = contactIds.length
      ? await supabaseAdmin
          .from("users")
          .select("id,full_name,email,phone,avatar_url")
          .in("id", contactIds)
      : { data: [], error: null };

    if (uErr) throw uErr;

    const usersMap: Record<string, any> = {};
    (users || []).forEach((u: any) => (usersMap[u.id] = u));

    // 3) merge
    const merged = (rows || []).map((r: any) => ({
      id: r.id,
      relationship: r.relationship,
      created_at: r.created_at,
      contact_user: usersMap[r.contact_user_id] || null,
    }));

    return NextResponse.json({ ok: true, contacts: merged });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}