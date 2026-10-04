import { NextRequest, NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "../../_auth";
import { getSupabaseAdmin } from "../../_supabaseAdmin";
import { canUseBeacon } from "@/lib/beacon";
import { notifyAdminIfBalanceLow, sendTermiiSms, termiiConfigured } from "../../_termii";
import { isRateLimitedDurable } from "../../_rateLimit";

/**
 * Send the NEXT pending provisioning command for a device, from its
 * queued job row.
 *
 * Why this exists: setup used to be a for-loop in the browser holding the
 * command list in memory. If a send failed, or the tab was closed, or the
 * SMS rate limit was hit partway through, the rest of the sequence was
 * simply lost. That is how a Beacon ended up still dialling a previous
 * owner's contacts: `familynum` sat at position 5 of 9 and never went.
 *
 * Now the job row in `beacon_config_jobs` is the single source of truth.
 * This route moves it forward one step at a time and `next_index` makes
 * that idempotent, so the client can drive it quickly while the
 * checkin-monitor cron drains whatever the client failed to finish. A
 * rate limit or a dropped tab delays setup; it can no longer lose it.
 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser(req);
    if (!canUseBeacon(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { deviceId } = await req.json();
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId required" }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id, sim_msisdn, status")
      .eq("id", String(deviceId))
      .eq("user_id", user.id)
      .maybeSingle();
    if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

    const { data: job } = await supabaseAdmin
      .from("beacon_config_jobs")
      .select("id, commands, next_index, status, kind")
      .eq("device_id", device.id)
      .in("status", ["queued", "sending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!job) {
      return NextResponse.json({ ok: true, done: true, sent: 0, index: 0, total: 0 });
    }

    const commands = (job.commands as { label: string; sms: string }[]) || [];
    const idx = job.next_index as number;
    if (idx >= commands.length) {
      await supabaseAdmin
        .from("beacon_config_jobs")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      return NextResponse.json({ ok: true, done: true, index: idx, total: commands.length });
    }

    const isRelease = job.kind === "release";
    if (!device.sim_msisdn || (device.status === "unpaired" && !isRelease)) {
      return NextResponse.json({ error: "Device is no longer paired" }, { status: 409 });
    }

    // Rate limited or gateway down: the command stays queued at the same
    // index and the cron sends it. Deliberately NOT an error the caller
    // has to recover from, because there is nothing to recover.
    const limited = await isRateLimitedDurable(`beacon-sms:${user.id}`, 20, 600);
    if (limited || !termiiConfigured()) {
      return NextResponse.json({
        ok: true,
        deferred: true,
        index: idx,
        total: commands.length,
        label: commands[idx].label,
      });
    }

    const result = await sendTermiiSms(device.sim_msisdn, commands[idx].sms);
    if (!result.ok) {
      const attempts = ((job as { attempts?: number }).attempts ?? 0) + 1;
      await supabaseAdmin
        .from("beacon_config_jobs")
        .update({
          attempts,
          last_error: result.error || "send failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return NextResponse.json({
        ok: true,
        deferred: true,
        index: idx,
        total: commands.length,
        label: commands[idx].label,
      });
    }

    notifyAdminIfBalanceLow(result.balance).catch(() => {});
    const nextIndex = idx + 1;
    await supabaseAdmin
      .from("beacon_config_jobs")
      .update({
        next_index: nextIndex,
        status: nextIndex >= commands.length ? "done" : "sending",
        attempts: 0,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    if (commands[idx].sms.startsWith("adminip") && device.status === "pairing") {
      await supabaseAdmin.from("devices").update({ status: "configuring" }).eq("id", device.id);
    }

    return NextResponse.json({
      ok: true,
      sent: 1,
      index: nextIndex,
      total: commands.length,
      done: nextIndex >= commands.length,
      label: commands[idx].label,
    });
  } catch (error) {
    return (
      authErrorResponse(error) ??
      NextResponse.json({ error: (error as Error).message }, { status: 500 })
    );
  }
}
