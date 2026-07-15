import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { isRateLimitedDurable } from "../../_rateLimit";

// Ambient location beat from the native Android service. Authenticated
// by the long-lived device key (see ../tracker-key), NOT a session token:
// the service outlives the app process and session tokens die in ~1h.
//
// The device gates fixes before sending; the server re-checks anyway
// (never trust a client, even our own): sane coordinates, sane accuracy,
// plausible speed. Rejected beats return 200 {ok:false} so the service
// drops them without retrying.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const key = String(body.key ?? "");
    if (!key.startsWith("pbk_") || key.length < 20) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hash = createHash("sha256").update(key).digest("hex");
    const supabaseAdmin = getSupabaseAdmin();
    const { data: keyRow } = await supabaseAdmin
      .from("device_tracking_keys")
      .select("user_id, revoked_at")
      .eq("secret_hash", hash)
      .maybeSingle();
    if (!keyRow || keyRow.revoked_at) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = keyRow.user_id as string;

    // The service beats every ~3 min; 30 per 10 min absorbs batched
    // deliveries while stopping a runaway or replayed key.
    if (await isRateLimitedDurable(`presence-beat:${userId}`, 30, 600)) {
      return NextResponse.json({ ok: false, reason: "throttled" });
    }

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const acc = body.accuracy_m != null ? Number(body.accuracy_m) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json({ ok: false, reason: "bad-coords" });
    }
    if (acc != null && acc > 800) {
      return NextResponse.json({ ok: false, reason: "accuracy" });
    }
    const speed = body.speed_kmh != null ? Number(body.speed_kmh) : null;
    if (speed != null && (speed < 0 || speed > 300)) {
      return NextResponse.json({ ok: false, reason: "speed" });
    }

    const { error } = await supabaseAdmin.from("presence").upsert({
      user_id: userId,
      lat,
      lng,
      accuracy_m: acc != null ? Math.round(acc) : null,
      speed_kmh: speed != null ? Math.round(speed * 10) / 10 : null,
      heading: body.heading != null && Number.isFinite(Number(body.heading)) ? Number(body.heading) : null,
      still_since: typeof body.still_since === "string" ? body.still_since : null,
      battery_pct:
        body.battery_pct != null && Number.isFinite(Number(body.battery_pct))
          ? Math.max(0, Math.min(100, Math.round(Number(body.battery_pct))))
          : null,
      captured_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[presence/beat] write failed:", error.message);
      return NextResponse.json({ ok: false, reason: "write" }, { status: 500 });
    }

    supabaseAdmin
      .from("device_tracking_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", userId)
      .then(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[presence/beat] unexpected error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
