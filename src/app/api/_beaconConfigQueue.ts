import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAdminIfBalanceLow, sendTermiiSms, termiiConfigured } from "./_termii";

// Drains the Beacon config queue a few commands per cron pass. Called from
// checkin-monitor (runs every minute), so the worst case for a device is
// roughly one command a minute: a full 9-command provisioning finishes in
// under ten minutes, and a thousand-device import steadily works through
// the fleet without ever bursting past the Termii budget.

// Global SMS budget per pass, across ALL jobs. Deliberately small: bulk
// onboarding is a background chore, and the wallet is shared with live
// interactive pairings which must never find it empty.
const SMS_PER_PASS = 12;

// A device's commands need breathing room between them (the firmware
// applies them in order); one command per device per pass gives ~60s gaps,
// more than the ~8s the interactive flow uses, which is fine: slower is
// safe, faster is not.
const MAX_ATTEMPTS = 3;

export async function drainBeaconConfigQueue(supabaseAdmin: SupabaseClient): Promise<number> {
  if (!termiiConfigured()) return 0;

  const { data: jobs } = await supabaseAdmin
    .from("beacon_config_jobs")
    .select("id, device_id, commands, next_index, status, attempts, kind")
    .in("status", ["queued", "sending"])
    .order("created_at", { ascending: true })
    .limit(SMS_PER_PASS);
  if (!jobs || jobs.length === 0) return 0;

  let sent = 0;
  for (const job of jobs) {
    if (sent >= SMS_PER_PASS) break;

    const commands = (job.commands as { label: string; sms: string }[]) || [];
    const idx = job.next_index as number;
    if (idx >= commands.length) {
      await supabaseAdmin
        .from("beacon_config_jobs")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      continue;
    }

    const { data: device } = await supabaseAdmin
      .from("devices")
      .select("id, sim_msisdn, status")
      .eq("id", job.device_id)
      .maybeSingle();
    // Release jobs are the exception: their whole purpose is to reach a
    // device we just unpaired and send it back to the vendor platform.
    const isRelease = job.kind === "release";
    if (!device?.sim_msisdn || (device.status === "unpaired" && !isRelease)) {
      await supabaseAdmin
        .from("beacon_config_jobs")
        .update({
          status: "failed",
          last_error: "Device missing or unpaired",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      continue;
    }

    const cmd = commands[idx];
    const result = await sendTermiiSms(device.sim_msisdn, cmd.sms);
    sent++;

    if (result.ok) {
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
      // First command flips a fresh device into configuring, mirroring the
      // interactive flow.
      if (cmd.sms.startsWith("adminip") && device.status === "pairing") {
        await supabaseAdmin
          .from("devices")
          .update({ status: "configuring" })
          .eq("id", device.id);
      }
    } else {
      const attempts = (job.attempts as number) + 1;
      await supabaseAdmin
        .from("beacon_config_jobs")
        .update({
          attempts,
          status: attempts >= MAX_ATTEMPTS ? "failed" : job.status,
          last_error: result.error || "send failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }
  }
  return sent;
}
