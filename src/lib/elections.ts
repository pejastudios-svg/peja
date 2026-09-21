import { authFetchJson } from "@/lib/authFetch";

// Election Watch client layer.
//
// The PIN never touches storage: it lives in this module's memory for 10
// minutes after entry, then evaporates. App restart, tab close, or expiry
// all mean re-entering it. That is the deal that makes a stolen unlocked
// phone useless for forging results.

export interface ElectionCandidate {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  sort: number;
}

export interface ElectionSummary {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  status: "active" | "closed";
  created_at: string;
  candidates: ElectionCandidate[];
  totals: Record<string, number>;
  uploadCount: number;
}

export interface SheetTally {
  id: string;
  figures: Record<string, number>;
  note: string | null;
  createdAt: string;
  superseded: boolean;
  /** Null below MVP tier: identities are working info, not audience info. */
  talliedBy: string | null;
}

export interface Sheet {
  id: string;
  state: string;
  lga: string;
  pollingUnit: string | null;
  photoUrl: string | null;
  sha256: string;
  hidden: boolean;
  hiddenReason: string | null;
  createdAt: string;
  /** Null below MVP tier. */
  uploaderName: string | null;
  tallies: SheetTally[];
}

export interface BrowseData {
  election: Omit<ElectionSummary, "candidates" | "totals" | "uploadCount">;
  candidates: ElectionCandidate[];
  totals: Record<string, number>;
  geoIndex: Record<string, Record<string, number>>;
  uploads: Sheet[];
}

export interface PinStatus {
  pinSet: boolean;
  locked: boolean;
  frozen: boolean;
  canTally: boolean;
}

// ── the in-memory PIN ──
const PIN_TTL_MS = 10 * 60 * 1000;
let cachedPin: { pin: string; at: number } | null = null;

export function getCachedPin(): string | null {
  if (!cachedPin) return null;
  if (Date.now() - cachedPin.at > PIN_TTL_MS) {
    cachedPin = null;
    return null;
  }
  return cachedPin.pin;
}

export function cachePin(pin: string) {
  cachedPin = { pin, at: Date.now() };
}

export function clearCachedPin() {
  cachedPin = null;
}

// ── API calls ──

export async function fetchElections(): Promise<ElectionSummary[]> {
  const { data } = await authFetchJson("/api/elections");
  return (data?.elections as ElectionSummary[]) || [];
}

export async function fetchBrowse(
  electionId: string,
  state?: string | null,
  lga?: string | null,
): Promise<BrowseData> {
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  if (lga) params.set("lga", lga);
  const { res, data } = await authFetchJson(
    `/api/elections/${electionId}/browse${params.size ? `?${params}` : ""}`,
  );
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not load");
  return data as BrowseData;
}

export async function fetchPinStatus(): Promise<PinStatus | null> {
  const { res, data } = await authFetchJson("/api/elections/pin");
  if (!res.ok || !data?.ok) return null;
  return data as PinStatus;
}

export async function setPin(pin: string, oldPin?: string): Promise<void> {
  const { res, data } = await authFetchJson("/api/elections/pin", {
    method: "POST",
    body: JSON.stringify({ pin, oldPin }),
  });
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not set the PIN");
}

export async function createElection(input: {
  pin: string;
  title: string;
  description?: string;
}): Promise<void> {
  const { res, data } = await authFetchJson("/api/elections", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not create the election");
}

export async function addCandidate(
  electionId: string,
  input: { pin: string; name: string; description?: string; photoDataUrl?: string | null },
): Promise<void> {
  const { res, data } = await authFetchJson(`/api/elections/${electionId}/candidates`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not add the candidate");
}

export async function uploadSheet(
  electionId: string,
  input: {
    pin: string;
    state: string;
    lga: string;
    pollingUnit?: string;
    /** Staged temp/ object from the silent pre-upload (preferred). */
    tempPath?: string;
    /** Inline bytes fallback: pre-upload failed or outbox replay. */
    photoDataUrl?: string;
    deviceLat?: number;
    deviceLng?: number;
    deviceAccuracyM?: number;
  },
): Promise<void> {
  const { res, data } = await authFetchJson(`/api/elections/${electionId}/upload`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Upload failed");
}

export async function tallySheet(
  electionId: string,
  input: {
    pin: string;
    uploadId: string;
    figures: Record<string, number>;
    note?: string;
    deviceLat?: number;
    deviceLng?: number;
  },
): Promise<{ corrected: boolean }> {
  const { res, data } = await authFetchJson(`/api/elections/${electionId}/tally`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok || !data?.ok) throw new Error(data?.error || "Could not save the tally");
  return { corrected: !!data.corrected };
}
