// SML (Share My Location / safety check-in) outbox handlers. Replay
// start / confirm / cancel actions that were queued while offline.
//
// All three handlers call the same API endpoints the online SMLButton
// uses — server-side validation (active check-in uniqueness, contact
// acceptance, etc.) stays single-sourced. On non-2xx the handler
// throws so the drain bumps attempts and tries again on the next
// online/visibility trigger.
//
// Auth: goes through authFetchJson, which pulls a fresh access token
// from supabase.auth.getSession() and does one refresh + retry if the
// server rejects it — a drain firing right after app-resume would
// otherwise replay with a stale token and burn retry attempts.

import { authFetchJson } from "../authFetch";
import type {
  SmlStartPayload,
  SmlConfirmPayload,
  SmlCancelPayload,
} from "../outbox";

async function postCheckin(
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<void> {
  const { res, data } = await authFetchJson(path, {
    method: "POST",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    // Try to surface the server's error message for the drain log.
    let detail = `${res.status} ${res.statusText}`;
    if (data?.error) detail = `${detail}: ${data.error}`;
    throw new Error(`${path} failed: ${detail}`);
  }
}

export async function dispatchSmlStart(payload: SmlStartPayload): Promise<void> {
  await postCheckin("/api/checkin/start/", {
    contactIds: payload.contactIds,
    intervalMinutes: payload.intervalMinutes,
  });
}

export async function dispatchSmlConfirm(
  payload: SmlConfirmPayload,
): Promise<void> {
  await postCheckin("/api/checkin/confirm/", {
    latitude: payload.latitude,
    longitude: payload.longitude,
  });
}

export async function dispatchSmlCancel(
  payload: SmlCancelPayload,
): Promise<void> {
  // triggeredAt lets the server ignore a stale queued cancel that
  // predates the currently active check-in — without it, a cancel
  // queued in a previous session could kill a share the user just
  // started.
  await postCheckin("/api/checkin/cancel/", {
    triggeredAt: payload.triggered_at,
  });
}
