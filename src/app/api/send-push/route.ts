import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../_auth";
import { sendPushToUser } from "../_firebaseAdmin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { userId, title, body, data } = await req.json();

    if (!userId || !title) {
      return NextResponse.json({ ok: false, error: "Missing userId or title" }, { status: 400 });
    }

    const sentCount = await sendPushToUser({ userId, title, body: body || "", data: data || {} });

    return NextResponse.json({ ok: true, sent: sentCount });
  } catch {
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
