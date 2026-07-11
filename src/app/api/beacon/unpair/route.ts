import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { canUseBeacon } from "@/lib/beacon";

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!canUseBeacon(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();
    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

    const { error } = await supabaseAdmin
      .from("devices")
      .update({ status: "unpaired", updated_at: new Date().toISOString() })
      .eq("id", device.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Optional cleanup texts: hand the device back to the vendor platform.
    return NextResponse.json({
      ok: true,
      commands: [
        { label: "Return device to factory platform", sms: "adminip123456 www.gps2828.com 7018" },
        { label: "Restart device", sms: "reset123456" },
      ],
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
