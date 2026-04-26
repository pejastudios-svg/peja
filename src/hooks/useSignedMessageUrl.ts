"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/api";

// Module-scoped cache shared across all components mounted in the app.
// Keys are storage paths (`messages/<convId>/<file>`), values are signed URLs
// with the absolute timestamp at which they expire client-side. We treat them
// as expired a minute early so renders don't 403 right at the boundary.
type Cached = { url: string; expiresAt: number };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<string | null>>();
const SAFETY_BUFFER = 60 * 1000;

// Storage URLs for the message-media bucket can land in either of two shapes:
//   …/storage/v1/object/public/message-media/<path>
//   …/storage/v1/object/sign/message-media/<path>?token=…
// Both decode to the same underlying path which is what the signing API needs.
function extractPath(rawUrl: string): string | null {
  if (!rawUrl) return null;
  const m = rawUrl.match(
    /\/storage\/v1\/object\/(?:public|sign)\/message-media\/([^?#]+)/
  );
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchSignedUrl(path: string): Promise<string | null> {
  const existing = inflight.get(path);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) return null;

      const res = await fetch(
        apiUrl(`/api/messages/signed-media-url?path=${encodeURIComponent(path)}`),
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return null;
      const json = await res.json();
      if (!json?.ok || !json?.url) return null;

      cache.set(path, {
        url: json.url,
        expiresAt: Date.now() + (json.expiresIn ?? 3600) * 1000 - SAFETY_BUFFER,
      });
      return json.url as string;
    } catch {
      return null;
    } finally {
      inflight.delete(path);
    }
  })();

  inflight.set(path, promise);
  return promise;
}

// Imperative variant for non-hook callsites (event handlers etc.). Returns
// the original URL for non-message-media inputs, the signed URL otherwise,
// and the original (which will 403) if signing fails — so the failure is
// visible rather than silent.
export async function signMessageUrl(rawUrl: string | null | undefined): Promise<string | null> {
  if (!rawUrl) return null;
  const path = extractPath(rawUrl);
  if (!path) return rawUrl;
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const signed = await fetchSignedUrl(path);
  return signed ?? rawUrl;
}

// Resolve a stored DM media URL to a freshly-signed one. Returns the original
// URL untouched if it doesn't belong to the message-media bucket (e.g. avatar
// URLs, external links). Returns `null` while a fetch is in flight, so callers
// can render a placeholder.
export function useSignedMessageUrl(rawUrl: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!rawUrl) return null;
    const path = extractPath(rawUrl);
    if (!path) return rawUrl;
    const cached = cache.get(path);
    return cached && cached.expiresAt > Date.now() ? cached.url : null;
  });

  useEffect(() => {
    if (!rawUrl) {
      setResolved(null);
      return;
    }
    const path = extractPath(rawUrl);
    if (!path) {
      setResolved(rawUrl);
      return;
    }

    const cached = cache.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      setResolved(cached.url);
      return;
    }

    let cancelled = false;
    setResolved(null);
    fetchSignedUrl(path).then((url) => {
      if (!cancelled) setResolved(url);
    });
    return () => {
      cancelled = true;
    };
  }, [rawUrl]);

  return resolved;
}
