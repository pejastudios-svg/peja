import { getSupabaseAdmin } from "./_supabaseAdmin";

/**
 * Durable, cross-instance rate limit backed by the peja_rate_limits table +
 * peja_rate_limit_hit function (see migration 20260704). Unlike the in-memory
 * version below, this is shared across serverless instances and survives cold
 * starts, so it actually holds under load.
 *
 * Returns true if the request should be BLOCKED (over the limit).
 *
 * FAILS OPEN: if the RPC isn't available yet (migration not applied) or errors,
 * this returns false (allowed) so rate limiting can never take down a route.
 * Availability of the limit is a feature; the endpoint's own auth still applies.
 */
export async function isRateLimitedDurable(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("peja_rate_limit_hit", {
      p_key: key,
      p_max: maxRequests,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn("[rateLimit] durable check failed, allowing:", error.message);
      return false; // fail open
    }
    // The function returns TRUE when allowed, so BLOCKED = !allowed.
    return data === false;
  } catch (e) {
    console.warn("[rateLimit] durable check threw, allowing:", e);
    return false; // fail open
  }
}

// In-memory rate limiter (resets on cold start, fine for Vercel serverless)
const store = new Map<string, { count: number; resetAt: number }>();

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store) {
    if (now > val.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Rate limit by key (usually `userId:action`).
 * Returns true if the request should be BLOCKED.
 *
 * @param key - unique key like "userId:report-post"
 * @param maxRequests - max requests allowed in the window
 * @param windowMs - time window in milliseconds
 */
export function isRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  if (entry.count > maxRequests) {
    return true;
  }

  return false;
}
