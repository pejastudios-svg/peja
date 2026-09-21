import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToUser } from "./_firebaseAdmin";
import { sendOpsAlert } from "./_email";

// Election Watch security layer.
//
// Threat model: a VIP's phone is stolen while unlocked. The login session
// is live, so session auth alone proves nothing. Every election WRITE
// therefore also requires the user's 6-digit action PIN, which exists
// only in their head and, transiently, in the app's memory (10 minutes,
// never persisted). Five wrong attempts lock the account's election
// actions until the admin unlocks; the owner and the admin both hear
// about failures early. The admin freeze switch kills a compromised
// account's election access outright, independent of the PIN.

export interface ElectionActor {
  userId: string;
  name: string;
  isAdmin: boolean;
  isMvp: boolean;
  isVip: boolean;
  /** VIP, MVP or admin: may create elections/candidates and upload. */
  canWrite: boolean;
  /** MVP or admin: may tally. */
  canTally: boolean;
  pinSet: boolean;
  locked: boolean;
  frozen: boolean;
}

export async function getElectionActor(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<ElectionActor> {
  const [{ data: u }, { data: access }] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("full_name, is_admin, is_vip, is_mvp")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("election_access")
      .select("pin_hash, failed_attempts, locked_at, frozen")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const isAdmin = !!u?.is_admin;
  const isMvp = !!u?.is_mvp;
  const isVip = !!u?.is_vip;
  return {
    userId,
    name: u?.full_name || "Someone",
    isAdmin,
    isMvp,
    isVip,
    canWrite: isAdmin || isMvp || isVip,
    canTally: isAdmin || isMvp,
    pinSet: !!access?.pin_hash,
    locked: !!access?.locked_at,
    frozen: !!access?.frozen,
  };
}

function hashPin(pin: string, salt: string): Buffer {
  return scryptSync(pin, salt, 32);
}

async function alertAdmin(supabaseAdmin: SupabaseClient, title: string, body: string) {
  try {
    const { data: admins } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("is_admin", true);
    for (const a of admins || []) {
      await supabaseAdmin.from("notifications").insert({
        user_id: a.id,
        type: "system",
        title,
        body,
        data: { type: "election_security" },
        is_read: false,
      });
      sendPushToUser({ userId: a.id, title, body, data: { type: "election_security" } }).catch(
        () => {},
      );
    }
    sendOpsAlert(title, body).catch(() => {});
  } catch {}
}

export async function setElectionPin(
  supabaseAdmin: SupabaseClient,
  userId: string,
  pin: string,
  oldPin?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{6}$/.test(pin)) return { ok: false, error: "The PIN must be 6 digits" };

  const { data: existing } = await supabaseAdmin
    .from("election_access")
    .select("pin_hash, pin_salt, locked_at, frozen")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.locked_at) return { ok: false, error: "Election actions are locked. Contact the admin." };
  if (existing?.frozen) return { ok: false, error: "Election access is frozen on this account." };

  // Changing an existing PIN proves knowledge of the old one. There is no
  // in-app "forgot PIN": reset goes through the admin, deliberately, so a
  // thief cannot rotate the PIN out from under the owner.
  if (existing?.pin_hash) {
    if (!oldPin) return { ok: false, error: "Enter your current PIN" };
    const ok = timingSafeEqual(
      hashPin(oldPin, existing.pin_salt),
      Buffer.from(existing.pin_hash, "hex"),
    );
    if (!ok) return { ok: false, error: "Current PIN is not right" };
  }

  const salt = randomBytes(16).toString("hex");
  await supabaseAdmin.from("election_access").upsert(
    {
      user_id: userId,
      pin_hash: hashPin(pin, salt).toString("hex"),
      pin_salt: salt,
      failed_attempts: 0,
      locked_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return { ok: true };
}

export async function verifyElectionPin(
  supabaseAdmin: SupabaseClient,
  actor: ElectionActor,
  pin: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (actor.frozen) {
    return { ok: false, error: "Election access is frozen on this account.", status: 403 };
  }
  const { data: access } = await supabaseAdmin
    .from("election_access")
    .select("pin_hash, pin_salt, failed_attempts, locked_at")
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!access?.pin_hash) {
    return { ok: false, error: "Set your election PIN first.", status: 428 };
  }
  if (access.locked_at) {
    return {
      ok: false,
      error: "Election actions are locked after too many wrong PINs. Contact the admin.",
      status: 423,
    };
  }
  if (!/^\d{6}$/.test(String(pin ?? ""))) {
    return { ok: false, error: "Enter your 6 digit PIN.", status: 401 };
  }

  const good = timingSafeEqual(
    hashPin(pin, access.pin_salt),
    Buffer.from(access.pin_hash, "hex"),
  );

  if (good) {
    if (access.failed_attempts > 0) {
      await supabaseAdmin
        .from("election_access")
        .update({ failed_attempts: 0, updated_at: new Date().toISOString() })
        .eq("user_id", actor.userId);
    }
    return { ok: true };
  }

  const attempts = (access.failed_attempts || 0) + 1;
  const lock = attempts >= 5;
  await supabaseAdmin
    .from("election_access")
    .update({
      failed_attempts: attempts,
      locked_at: lock ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", actor.userId);

  // The owner hears about every failure past the second; the admin hears
  // at three and at lockout. A thief guessing quietly is the worst case.
  if (attempts >= 2) {
    sendPushToUser({
      userId: actor.userId,
      title: "Wrong election PIN entered",
      body: `${attempts} failed attempt${attempts === 1 ? "" : "s"} on your election PIN. If this is not you, tell the admin immediately.`,
      data: { type: "election_security" },
    }).catch(() => {});
  }
  if (attempts === 3) {
    await alertAdmin(
      supabaseAdmin,
      "Election PIN failures",
      `3 failed PIN attempts on ${actor.name}'s election access.`,
    );
  }
  if (lock) {
    await alertAdmin(
      supabaseAdmin,
      "Election access locked",
      `${actor.name}'s election actions are locked after 5 failed PIN attempts. Review and unlock from the admin dashboard.`,
    );
  }

  return {
    ok: false,
    error: lock
      ? "Too many wrong PINs. Election actions are locked; contact the admin."
      : "Wrong PIN.",
    status: lock ? 423 : 401,
  };
}
