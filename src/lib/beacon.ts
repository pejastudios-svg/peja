// Beacon 1 (P02L tracker) shared helpers: feature gate, types, and the
// SMS command sequence used to provision a device.
//
// Feature gate: the Beacon 1 UI is in a closed pilot. Only the accounts
// below can see the fan button and the /beacon page. Server routes check
// the same list. Widen (or remove) when the pilot opens up.

const BEACON_PILOT_EMAILS = ["pejastudios@gmail.com"];

export function canUseBeacon(email?: string | null): boolean {
  if (!email) return false;
  return BEACON_PILOT_EMAILS.includes(email.trim().toLowerCase());
}

export interface BeaconDevice {
  id: string;
  device_id: string;
  sim_msisdn: string;
  name: string;
  status: "pairing" | "configuring" | "connected" | "offline" | "unpaired";
  family1_contact_id: string | null;
  family2_contact_id: string | null;
  sos_msisdn: string | null;
  volume: number;
  fall_alert_enabled: boolean;
  sos_ack_tone: boolean;
  intercom_enabled: boolean;
  battery_pct: number | null;
  last_lat: number | null;
  last_lng: number | null;
  last_fix_at: string | null;
  last_seen_at: string | null;
  created_at: string;
}

/** Extract a Beacon device id from a QR scan (`tel:67084982860`) or typed input. */
export function parseDeviceId(raw: string): string | null {
  const digits = raw.trim().replace(/^tel:/i, "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits.replace(/^0+/, "");
}

/**
 * Normalize a phone number for the device's dialer. The tracker dials
 * exactly what it is given, so prefer the local 0-prefixed form the SIM
 * network expects (+234 801... -> 0801...).
 */
export function devicePhone(phone: string): string {
  const p = phone.replace(/[^\d+]/g, "");
  if (p.startsWith("+234")) return "0" + p.slice(4);
  if (p.startsWith("234") && p.length > 10) return "0" + p.slice(3);
  return p;
}

export interface BeaconCommand {
  /** Short label shown in the UI. */
  label: string;
  /** Exact SMS body to send to the device SIM. */
  sms: string;
}

/**
 * Full provisioning sequence for a fresh pairing. During the pilot these
 * are sent manually (texted to the device SIM); later an SMS gateway sends
 * them automatically. Order matters; ~10s apart.
 */
export function pairingCommands(opts: {
  gatewayHost: string;
  gatewayPort: number;
  family1Phone?: string | null;
  family2Phone?: string | null;
  sosPhone?: string | null;
  volume: number;
}): BeaconCommand[] {
  const cmds: BeaconCommand[] = [
    {
      label: "Point device at the peja gateway",
      sms: `adminip123456 ${opts.gatewayHost} ${opts.gatewayPort}`,
    },
    { label: "Smart tracking mode (60s while moving)", sms: "md123456 3 60S" },
    // Undocumented but confirmed on-device 2026-07: fall detection ships
    // OFF (check123456 shows A:0). Without this the app's fall toggle
    // would silently do nothing. Whether anyone is NOTIFIED stays
    // controlled by devices.fall_alert_enabled in the app.
    { label: "Enable fall detection", sms: "falldown123456 1" },
  ];
  if (opts.family1Phone) {
    const f1 = devicePhone(opts.family1Phone);
    const f2 = opts.family2Phone ? ` ${devicePhone(opts.family2Phone)}` : "";
    cmds.push({ label: "Program call buttons (contacts 1 and 2)", sms: `familynum123456 ${f1}${f2}` });
  }
  if (opts.sosPhone) {
    cmds.push({ label: "SOS long-press calls contact 1", sms: `admin123456 ${devicePhone(opts.sosPhone)}` });
  }
  cmds.push(
    { label: "Quiet volume", sms: `vol123456 ${Math.min(4, Math.max(0, opts.volume))}` },
    { label: "Walkie-talkie off", sms: "interon123456 0" },
    { label: "Restart device to apply", sms: "reset123456" },
  );
  return cmds;
}

/** Commands needed after a settings change (only what changed). */
export function settingsCommands(changes: {
  volume?: number;
  family1Phone?: string | null;
  family2Phone?: string | null;
  sosPhone?: string | null;
  intercomEnabled?: boolean;
}): BeaconCommand[] {
  const cmds: BeaconCommand[] = [];
  if (changes.family1Phone !== undefined && changes.family1Phone) {
    const f2 = changes.family2Phone ? ` ${devicePhone(changes.family2Phone)}` : "";
    cmds.push({
      label: "Update call buttons",
      sms: `familynum123456 ${devicePhone(changes.family1Phone)}${f2}`,
    });
  }
  if (changes.sosPhone !== undefined && changes.sosPhone) {
    cmds.push({ label: "Update SOS number", sms: `admin123456 ${devicePhone(changes.sosPhone)}` });
  }
  if (changes.volume !== undefined) {
    cmds.push({ label: "Update volume", sms: `vol123456 ${Math.min(4, Math.max(0, changes.volume))}` });
  }
  if (changes.intercomEnabled !== undefined) {
    cmds.push({
      label: changes.intercomEnabled ? "Walkie-talkie on" : "Walkie-talkie off",
      sms: `interon123456 ${changes.intercomEnabled ? 1 : 0}`,
    });
  }
  return cmds;
}
