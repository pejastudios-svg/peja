/**
 * Who a broadcast goes to, and how it is delivered.
 *
 * Client-safe: types and labels only, no database access. The server-side
 * resolver lives in app/api/_broadcastAudience.ts.
 */

export type BroadcastAudience =
  | { kind: "all" }
  | { kind: "no_recovery_codes" }
  | { kind: "no_contacts" }
  | { kind: "states"; states: string[] }
  | { kind: "role"; role: "guardian" | "vip" | "mvp" | "beacon_owner" }
  | { kind: "inactive"; days: number };

export type BroadcastDelivery = "push" | "in_app" | "popup";

export const AUDIENCE_KINDS: { kind: BroadcastAudience["kind"]; label: string; hint: string }[] = [
  { kind: "all", label: "Everyone", hint: "Every active account" },
  {
    kind: "no_recovery_codes",
    label: "No recovery codes",
    hint: "Accounts that cannot get back in if they forget their password",
  },
  {
    kind: "no_contacts",
    label: "Fewer than 2 contacts",
    hint: "Counts accepted contacts only, not pending invites",
  },
  { kind: "states", label: "By state", hint: "People who follow the states you pick" },
  { kind: "role", label: "By role", hint: "Guardians, VIPs, MVPs or beacon owners" },
  { kind: "inactive", label: "Inactive", hint: "Not seen for a number of days" },
];

export const DELIVERY_OPTIONS: {
  value: BroadcastDelivery;
  label: string;
  hint: string;
  sensitive?: boolean;
}[] = [
  {
    value: "push",
    label: "Push and in-app",
    hint: "Arrives on the lock screen and waits in their notifications. Readable by anyone near the phone.",
  },
  {
    value: "in_app",
    label: "In-app only",
    hint: "Waits in their notifications. Nothing on the lock screen.",
  },
  {
    value: "popup",
    label: "In-app popup",
    hint: "A card on next open, dismissed once. Stays behind the login.",
  },
];

export function describeAudience(a: BroadcastAudience): string {
  switch (a.kind) {
    case "all":
      return "Everyone";
    case "no_recovery_codes":
      return "Accounts with no recovery codes";
    case "no_contacts":
      return "Accounts with fewer than 2 accepted contacts";
    case "states":
      return a.states.length ? `Following ${a.states.join(", ")}` : "By state (none picked)";
    case "role":
      return `Role: ${a.role.replace("_", " ")}`;
    case "inactive":
      return `Not seen for ${a.days}+ days`;
    default:
      return "Unknown";
  }
}

/**
 * Anything whose subject matter could put someone in danger if a person
 * standing next to them read it off a lock screen. These are offered as
 * in-app or popup only.
 *
 * Not a nanny check, a threat model: a user living with an abusive partner
 * should not have a notification about gender-based violence surface on a
 * screen that partner can see. It is the same lock-screen problem that
 * took reset codes out of push.
 */
export function deliveryIsSafeForSensitive(d: BroadcastDelivery): boolean {
  return d !== "push";
}
