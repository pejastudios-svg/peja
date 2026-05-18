import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "../../../_auth";
import { getSupabaseAdmin } from "../../../_supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const body = await req.json();
    const ticketId = String(body?.ticketId ?? "").trim();
    if (!ticketId) {
      return NextResponse.json({ ok: false, error: "Missing ticketId" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("support_tickets")
      .delete()
      .eq("id", ticketId);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const status = /Admin|PIN/i.test(msg) ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
