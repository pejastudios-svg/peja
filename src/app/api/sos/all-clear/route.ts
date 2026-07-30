import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { requireUser, authErrorResponse } from "../../_auth";
import { notifyAllClear } from "../../_allClear";

// Tell the people who were alarmed that the user is okay, after they
// cancel an SOS from the app. Server-side so it can reach contacts the
// client has no permission to notify directly.
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    const supabaseAdmin = getSupabaseAdmin();

    const notified = await notifyAllClear(supabaseAdmin, user.id, "app");
    return NextResponse.json({ ok: true, notified });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: "Could not send the all clear" }, { status: 500 })
    );
  }
}
