// SML (Share My Location / safety check-in) outbox handlers. Replay
// start / confirm / cancel actions that were queued while offline.
//
// All three handlers call the same API endpoints the online SMLButton
// uses — server-side validation (active check-in uniqueness, contact
// acceptance, etc.) stays single-sourced. On non-2xx the handler
// throws so the drain bumps attempts and tries again on the next
// online/visibility trigger.
//
// Auth header: the drain runs inside the user's session, so we can
// pull the access token from supabase.auth.getSession() the same way
// the SMLButton component does.

import { supabase } from "../supabase";
import { apiUrl } from "../api";
import type {
  SmlStartPayload,
  SmlConfirmPayload,
  SmlCancelPayload,
} from "../outbox";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function postCheckin(
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<void> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: await authHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    // Try to surface the server's error message for the drain log.
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.error) detail = `${detail}: ${data.error}`;
    } catch {}
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
  _payload: SmlCancelPayload,
): Promise<void> {
  await postCheckin("/api/checkin/cancel/", undefined);
}
