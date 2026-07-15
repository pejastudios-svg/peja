// Auth-aware fetch for /api/* routes.
//
// Components previously built Authorization headers from the React
// context's session object, which can hold a stale access token for a
// window after the app resumes from background (Capacitor suspends the
// WebView's timers, so supabase-js can't proactively refresh). This
// helper instead:
//
//   1. Pulls the token from supabase.auth.getSession(), which refreshes
//      an expired session itself when it can.
//   2. If the server still rejects the token (401 / token_expired), does
//      ONE refreshSession() and retries the request once.
//
// Callers get the parsed JSON plus an `authFailed` flag so they can
// distinguish "your session is genuinely dead, re-login" from ordinary
// request errors. Network-level failures (fetch rejection) still throw,
// same as plain fetch — callers keep their existing catch behavior.

import { supabase } from "./supabase";
import { apiUrl } from "./api";

// Arbitrary JSON from the API; call sites narrow what they read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function currentToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function isAuthFailure(status: number, data: Json): boolean {
  if (status === 401) return true;
  const code = data?.code;
  if (
    code === "token_expired" ||
    code === "invalid_token" ||
    code === "missing_token"
  ) {
    return true;
  }
  // Routes not yet migrated to authErrorResponse ship auth failures as
  // 500 + message; recognize the known phrasings so the retry still
  // kicks in for them.
  const msg = typeof data?.error === "string" ? data.error : "";
  return /session expired|invalid user|authorization token/i.test(msg);
}

export interface AuthJsonResult {
  res: Response;
  /** Parsed JSON body, or null if the body wasn't JSON. */
  data: Json;
  /** True when the request failed auth even after a refresh + retry. */
  authFailed: boolean;
}

// Fired after any successful mutation that can change who is in the
// user's circle. MapHome and CommunityNudge listen and refetch right
// away instead of waiting out the 45s ambient poll.
export const CIRCLE_REFRESH_EVENT = "peja-circle-refresh";

/** Tell circle-aware surfaces (map sheet, empty-circle nudge) to refetch
 * now. Call after any mutation that changes who is in the circle. */
export function signalCircleRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CIRCLE_REFRESH_EVENT));
  }
}

const CIRCLE_PATHS = /\/api\/(community|emergency-contacts|contacts)\b/;

function maybeSignalCircleChange(path: string, init: RequestInit, ok: boolean) {
  const method = (init.method || "GET").toUpperCase();
  if (!ok || method === "GET") return;
  if (CIRCLE_PATHS.test(path) || CIRCLE_PATHS.test(apiUrl(path))) {
    signalCircleRefresh();
  }
}

export async function authFetchJson(
  path: string,
  init: RequestInit = {},
): Promise<AuthJsonResult> {
  const attempt = async (token: string | null) => {
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string> | undefined) || {}),
    };
    if (init.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    headers.Authorization = `Bearer ${token || ""}`;

    const res = await fetch(apiUrl(path), { ...init, headers });
    let data: Json = null;
    try {
      data = await res.json();
    } catch {}
    return { res, data };
  };

  let { res, data } = await attempt(await currentToken());
  if (!isAuthFailure(res.status, data)) {
    maybeSignalCircleChange(path, init, res.ok);
    return { res, data, authFailed: false };
  }

  // The server rejected the token. Refresh once and retry once; if the
  // refresh itself fails (offline, revoked refresh token) fall back to
  // whatever getSession still holds so the retry at least mirrors the
  // first attempt's outcome.
  let newToken: string | null = null;
  try {
    const { data: refreshed } = await supabase.auth.refreshSession();
    newToken = refreshed.session?.access_token ?? null;
  } catch {}
  if (!newToken) newToken = await currentToken();

  ({ res, data } = await attempt(newToken));
  maybeSignalCircleChange(path, init, res.ok);
  return { res, data, authFailed: isAuthFailure(res.status, data) };
}
