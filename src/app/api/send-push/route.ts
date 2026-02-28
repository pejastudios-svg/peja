import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { getSupabaseAdmin } from "../_supabaseAdmin";
import { sendPushToUser } from "../_firebaseAdmin";
import { isRateLimited } from "../_rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);

    const supabaseAdmin = getSupabaseAdmin();
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!userData?.is_admin) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const { userId, title, body, data } = await req.json();

    if (!userId || !title) {
      return NextResponse.json(
        { ok: false, error: "Missing userId or title" },
        { status: 400 }
      );
    }

    const sentCount = await sendPushToUser({
      userId,
      title,
      body: body || "",
      data: data || {},
    });

    return NextResponse.json({ ok: true, sent: sentCount });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}
