import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { sendPushToUser } from "../../_firebaseAdmin";

// Low-battery watch. A safety device that quietly dies is a safety device
// that is not there when it matters, so somebody must be told BEFORE it
// goes flat.
//
// Runs as a poller rather than a hook because battery levels are written
// by the TCP gateway (a separate service), so there is no request of ours
// to hang this off.
//
// Two watches:
//   1. Beacon battery  -> tell the owner.
//   2. Phone battery   -> tell the people watching that person, so a dot
//      that is about to freeze is explained instead of mysterious.
//
// Repeat-alert control uses the notifications table itself (no extra
// schema): if we already warned within the cooldown, stay quiet.

const LOW_PCT = 15;
const BEACON_COOLDOWN_H = 12;
const PHONE_COOLDOWN_H = 24;
// Only speak about a phone whose reading is recent; a days-old 9% says
// nothing useful about right now.
const PHONE_FRESH_MIN = 30;
const BATCH = 200;

async function alertedRecently(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  type: string,
  subjectKey: string,
  subjectValue: string,
  hours: number,
): Promise<boolean> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("data->>type", type)
    .eq(`data->>${subjectKey}`, subjectValue)
    .gte("created_at", since)
    .limit(1);
  return Boolean(data && data.length > 0);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const queryToken = req.nextUrl.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  const authorized =
    (expected && authHeader === `Bearer ${expected}`) ||
    (expected && queryToken === expected);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  let beaconsWarned = 0;
  let phonesWarned = 0;

  // ── 1. Beacons ──────────────────────────────────────────────────────
  try {
    const { data: devices } = await supabaseAdmin
      .from("devices")
      .select("id, user_id, name, battery_pct, status")
      .lte("battery_pct", LOW_PCT)
      .not("battery_pct", "is", null)
      .neq("status", "unpaired")
      .limit(BATCH);

    for (const d of devices || []) {
      if (
        await alertedRecently(
          supabaseAdmin,
          d.user_id,
          "beacon_low_battery",
          "device_id",
          d.id,
          BEACON_COOLDOWN_H,
        )
      ) {
        continue;
      }

      const name = d.name || "Your Beacon";
      const title = `${name} battery is low`;
      const body = `${d.battery_pct}% left. Charge it soon so it can still call for help.`;

      await supabaseAdmin.from("notifications").insert({
        user_id: d.user_id,
        type: "system",
        title,
        body,
        data: { type: "beacon_low_battery", device_id: d.id, battery_pct: d.battery_pct },
        is_read: false,
      });
      sendPushToUser({
        userId: d.user_id,
        title,
        body,
        data: { type: "beacon_low_battery", device_id: String(d.id) },
      }).catch(() => {});
      beaconsWarned++;
    }
  } catch (e) {
    console.error("[battery-monitor] beacon pass failed:", e);
  }

  // ── 2. Phones ───────────────────────────────────────────────────────
  try {
    const freshCutoff = new Date(Date.now() - PHONE_FRESH_MIN * 60_000).toISOString();
    const { data: presences } = await supabaseAdmin
      .from("presence")
      .select("user_id, battery_pct, captured_at")
      .lte("battery_pct", LOW_PCT)
      .not("battery_pct", "is", null)
      .gte("captured_at", freshCutoff)
      .limit(BATCH);

    for (const p of presences || []) {
      // Who is allowed to see this person, and would therefore notice
      // their dot freeze: protectors they have not hidden from, plus
      // people they share back with.
      const [protectorsRes, sharedBackRes, meRes] = await Promise.all([
        supabaseAdmin
          .from("emergency_contacts")
          .select("contact_user_id")
          .eq("user_id", p.user_id)
          .eq("status", "accepted")
          .eq("hide_from_contact", false),
        supabaseAdmin
          .from("emergency_contacts")
          .select("user_id")
          .eq("contact_user_id", p.user_id)
          .eq("status", "accepted")
          .eq("share_back", true),
        supabaseAdmin.from("users").select("full_name").eq("id", p.user_id).maybeSingle(),
      ]);

      const watchers = [
        ...new Set([
          ...(protectorsRes.data || []).map((r) => r.contact_user_id as string),
          ...(sharedBackRes.data || []).map((r) => r.user_id as string),
        ]),
      ].filter((id) => id && id !== p.user_id);
      if (watchers.length === 0) continue;

      const name = (meRes.data?.full_name || "Someone").split(" ")[0];
      const title = `${name}'s phone battery is low`;
      const body = `${p.battery_pct}% left. Their location may stop updating if the phone dies.`;

      const rows: Record<string, unknown>[] = [];
      for (const w of watchers) {
        if (
          await alertedRecently(
            supabaseAdmin,
            w,
            "contact_low_battery",
            "from_user_id",
            p.user_id,
            PHONE_COOLDOWN_H,
          )
        ) {
          continue;
        }
        rows.push({
          user_id: w,
          type: "system",
          title,
          body,
          data: {
            type: "contact_low_battery",
            from_user_id: p.user_id,
            battery_pct: p.battery_pct,
          },
          is_read: false,
        });
      }
      if (rows.length === 0) continue;

      await supabaseAdmin.from("notifications").insert(rows);
      for (const r of rows) {
        sendPushToUser({
          userId: r.user_id as string,
          title,
          body,
          data: { type: "contact_low_battery", from_user_id: p.user_id },
        }).catch(() => {});
      }
      phonesWarned += rows.length;
    }
  } catch (e) {
    console.error("[battery-monitor] phone pass failed:", e);
  }

  return NextResponse.json({ ok: true, beaconsWarned, phonesWarned });
}
