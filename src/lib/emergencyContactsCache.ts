// Local snapshot of the signed-in user's emergency contacts. We cache
// name + phone so the offline SOS path can dispatch SMS without
// touching the network. Refreshed opportunistically every time the
// SOS button mounts while online (cheap), and every time the user
// edits the contacts list.
//
// Stored per-user so a shared device doesn't leak one account's
// contacts into another's session.

const KEY_PREFIX = "peja:emergency-contacts:v1:";
// Sibling cache for the "Protecting" tab on the emergency contacts
// page — the inverse lookup, i.e. people who have added ME as their
// emergency contact (pending invites + accepted protections). This is
// a separate cache because the rows have a different meaning (rows
// owned by *other* users, where contact_user_id = me) — mixing them
// into the main cache would confuse SOS/SML which only care about
// outgoing contacts.
const PROTECTING_KEY_PREFIX = "peja:protecting-cache:v1:";

export interface CachedEmergencyContact {
  // emergency_contacts.id — the row id, not the linked Peja user id.
  id: string;
  // emergency_contacts.name + phone — used by the offline SOS SMS
  // path (phone is the recipient, name is just for display).
  name: string;
  phone: string;
  // emergency_contacts.contact_user_id — set when the contact is
  // also a Peja user. Used by SML to target push/in-app notifications.
  contact_user_id: string | null;
  // emergency_contacts.status — SML only shows contacts with status
  // "accepted"; SOS SMS uses everyone with a phone number regardless
  // of status (it's a one-way carrier SMS, no app handshake needed).
  status: "pending" | "accepted" | "declined" | null;
  // emergency_contacts.relationship — shown beneath the name on the
  // Emergency Contacts page. Optional in the cache shape so older
  // payloads written before this field was tracked still parse.
  relationship?: string | null;
  // Snapshot from the users table, joined at cache time. Used by
  // SML's share sheet to render the row offline.
  linked_full_name: string | null;
  linked_avatar_url: string | null;
}

interface CachedSnapshot {
  contacts: CachedEmergencyContact[];
  cached_at: number;
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function readEmergencyContactsCache(
  userId: string,
): CachedEmergencyContact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedSnapshot;
    if (!parsed || !Array.isArray(parsed.contacts)) return [];
    return parsed.contacts.filter(
      (c): c is CachedEmergencyContact =>
        typeof c === "object" &&
        c !== null &&
        typeof c.id === "string" &&
        typeof c.name === "string",
    );
  } catch {
    return [];
  }
}

export function writeEmergencyContactsCache(
  userId: string,
  contacts: CachedEmergencyContact[],
): void {
  if (typeof window === "undefined") return;
  try {
    const snapshot: CachedSnapshot = {
      contacts,
      cached_at: Date.now(),
    };
    window.localStorage.setItem(keyFor(userId), JSON.stringify(snapshot));
  } catch {
    // Quota / private-browsing — accept it; offline SOS just won't
    // have contacts to dispatch.
  }
}

export function clearEmergencyContactsCache(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {}
}

// ─── Protecting cache (incoming invites + accepted "I'm their contact") ───

export interface CachedProtectingRow {
  // emergency_contacts.id (the relationship row).
  id: string;
  // emergency_contacts.user_id — the OTHER user, the inviter / owner
  // of the relationship. We're their contact.
  user_id: string;
  // The inviter's snapshot from the users table.
  full_name: string | null;
  avatar_url: string | null;
  // emergency_contacts.relationship — "Parent", "Friend", etc.
  relationship: string | null;
  // "pending" → shows in Pending Requests; "accepted" → shows under
  // people I'm protecting; "declined" → rows we don't render so we
  // don't cache them.
  status: "pending" | "accepted";
}

interface CachedProtectingSnapshot {
  rows: CachedProtectingRow[];
  cached_at: number;
}

function protectingKeyFor(userId: string): string {
  return `${PROTECTING_KEY_PREFIX}${userId}`;
}

export function readProtectingCache(userId: string): CachedProtectingRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(protectingKeyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedProtectingSnapshot;
    if (!parsed || !Array.isArray(parsed.rows)) return [];
    return parsed.rows.filter(
      (r): r is CachedProtectingRow =>
        typeof r === "object" &&
        r !== null &&
        typeof r.id === "string" &&
        typeof r.user_id === "string",
    );
  } catch {
    return [];
  }
}

export function writeProtectingCache(
  userId: string,
  rows: CachedProtectingRow[],
): void {
  if (typeof window === "undefined") return;
  try {
    const snapshot: CachedProtectingSnapshot = {
      rows,
      cached_at: Date.now(),
    };
    window.localStorage.setItem(protectingKeyFor(userId), JSON.stringify(snapshot));
  } catch {}
}
