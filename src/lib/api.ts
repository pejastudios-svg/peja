/**
 * Resolves API route paths.
 *
 * On the web (Vercel), returns the path as-is:        "/api/delete-my-post"
 * Inside Capacitor native shell, returns absolute URL: "https://peja.vercel.app/api/delete-my-post"
 *
 * This is necessary because Capacitor serves the app from a local origin
 * (e.g. capacitor://localhost), so relative /api/* paths won't reach Vercel.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

export function apiUrl(path: string): string {
  // If a base URL is configured (for native builds), prepend it
  if (API_BASE_URL) {
    // Ensure no double slashes: base might end with /, path starts with /
    const base = API_BASE_URL.replace(/\/+$/, "");
    const route = path.startsWith("/") ? path : `/${path}`;
    return `${base}${route}`;
  }

  // On the web, return as-is (relative path works with Vercel)
  return path;
}