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
