// Local snapshot of the signed-in user's emergency contacts. We cache
// name + phone so the offline SOS path can dispatch SMS without
// touching the network. Refreshed opportunistically every time the
// SOS button mounts while online (cheap), and every time the user
// edits the contacts list.
//
// Stored per-user so a shared device doesn't leak one account's
// contacts into another's session.

const KEY_PREFIX = "peja:emergency-contacts:v1:";

export interface CachedEmergencyContact {
  id: string;
  name: string;
  phone: string;
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
        typeof c.name === "string" &&
        typeof c.phone === "string" &&
        c.phone.length > 0,
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
