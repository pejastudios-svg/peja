// Peja Service Worker v17 - Offline-First Safety App
const CACHE_NAME = "peja-v17";
const APP_SHELL_CACHE = "peja-shell-v17";
// Bumped to v6 to invalidate stale /rest/v1/messages and conversations
// responses. Like posts before them (v5 bump), they're now network-first
// so user mutations (clear chat, delete message, block) reflect on the
// next read instead of waiting for SWR to background-refresh.
const DATA_CACHE = "peja-data-v6";
const MEDIA_CACHE = "peja-media-v3";
const VIDEO_CACHE = "peja-video-v3";

// HTML routes to pre-cache. Trailing slashes match Next.js's
// trailingSlash: true canonical form — without them, fetch() follows a
// 308 redirect and the response comes back with `redirected = true`,
// which Cache API silently refuses to store (the cause of /map, /search,
// etc. NOT being available offline on cold start even though APP_SHELL
// listed them). cacheHtmlPage also stores under the request URL so
// either form is a cache hit.
const APP_SHELL_PAGES = [
  "/",
  "/map/",
  "/search/",
  "/create/",
  "/profile/",
  "/profile/edit/",
  "/notifications/",
  "/messages/",
  "/login/",
  "/signup/",
  "/forgot-password/",
  "/settings/",
  "/emergency-contacts/",
  "/become-guardian/",
  "/checkin/shared/",
  "/help/",
  "/privacy/",
  "/terms/",
  // Placeholder dynamic-route URLs. Pre-cached so findDynamicRouteShell
  // always has a "sibling" entry to return when the user navigates to
  // an unfamiliar /post/<id>, /messages/<id>, /checkin/track/<id>,
  // etc. offline. The all-zero UUID 404s on the server-side data
  // lookup, but the HTML shell + chunks are identical for every ID —
  // Next.js boots from window.location after hydration, so the
  // requested ID's page renders correctly. Without these, activate's
  // peja-shell-v* nuke can leave the user with no dynamic-route shell
  // and the SW falls all the way through to "/" → hard refresh.
  "/post/00000000-0000-0000-0000-000000000000/",
  "/messages/00000000-0000-0000-0000-000000000000/",
  "/checkin/track/00000000-0000-0000-0000-000000000000/",
  "/watch/00000000-0000-0000-0000-000000000000/",
];

// Static files alongside the HTML pages. These don't redirect so the
// plain shell.add() path is fine.
const APP_SHELL_FILES = [
  "/peja-logo.png.png",
];

const STATIC_PATTERNS = [
  /\/_next\/static\/.*/,
  /\.(?:js|css|woff2?|ttf|eot)$/,
];

const IMAGE_PATTERNS = [
  /\.(?:png|jpg|jpeg|gif|svg|ico|webp)$/,
  /ui-avatars\.com/,
  /res\.cloudinary\.com.*\/image\//,
];

// IMPORTANT: any rows the signed-in user can mutate must be network-first.
// SWR caused: deleted posts resurrecting on refresh, "clear chat" not
// taking effect until a hard reload, and Edit Profile showing pre-save
// values on first reopen. All same root cause — the cached response still
// reflected the pre-mutation state and SWR served it before refreshing.
// Leave this list empty unless adding a truly read-only collection.
const CACHEABLE_DATA_PATTERNS = [];

const NETWORK_FIRST_PATTERNS = [
  /supabase\.co\/rest\/v1\/posts/,
  /supabase\.co\/rest\/v1\/messages/,
  /supabase\.co\/rest\/v1\/conversations/,
  /supabase\.co\/rest\/v1\/users/,
  /supabase\.co\/rest\/v1\/user_settings/,
];

const NO_CACHE_PATTERNS = [
  /supabase\.co\/auth/,
  /supabase\.co\/realtime/,
  /supabase\.co\/storage/,
  /googleapis\.com/,
  /firebase/,
  /nominatim\.openstreetmap\.org/,
];

// Pull <link rel="stylesheet" ...> and <script src="..."> URLs out of
// an HTML string. Best-effort regex parse — good enough for Next.js
// app router output where the asset URLs are emitted as plain
// attributes. Used at install time so we can warm the static cache
// with the chunks the root page actually depends on, so an offline
// cold-open after install still renders styled.
function extractAssetUrls(html) {
  const urls = [];
  const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/g;
  let m;
  while ((m = linkRe.exec(html))) urls.push(m[1]);
  const scriptRe = /<script[^>]+src=["']([^"']+)["']/g;
  while ((m = scriptRe.exec(html))) urls.push(m[1]);
  return urls;
}

// Route prefixes whose URLs are interchangeable for offline-shell
// purposes. A request to /post/<id-A>/ can be served using the HTML
// previously cached for /post/<id-B>/ — the Next.js bootstrap loads
// the same chunks regardless of <id> and re-resolves the route via
// window.location after hydration. The static parent route (e.g.
// "/messages/" the list) is intentionally NOT returned here, since
// it's a different page than "/messages/<id>/".
const DYNAMIC_ROUTE_PREFIXES = [
  "/post/",
  "/messages/",
  "/checkin/track/",
  "/checkin/shared/",
  "/watch/",
];

async function findDynamicRouteShell(pathname) {
  const prefix = DYNAMIC_ROUTE_PREFIXES.find((p) => pathname.startsWith(p));
  if (!prefix) return null;
  // Skip the bare parent route — that's the list page, not a shell
  // for the dynamic child route.
  const noTrail = prefix.slice(0, -1);
  if (pathname === prefix || pathname === noTrail) return null;
  try {
    // Scan EVERY versioned shell cache, newest first. A single-cache
    // scan was missing the case where the just-activated cache had no
    // placeholder yet (install hadn't completed, or had been
    // interrupted) but the previous version's cache still did. The
    // activate handler keeps MAX_SHELL_CACHES previous shells around
    // for exactly this reason.
    const allCaches = await caches.keys();
    const shellNames = allCaches
      .filter((k) => SHELL_VERSION_PATTERN.test(k))
      .map((k) => {
        const m = k.match(/^peja-shell-v(\d+)$/);
        return { name: k, n: m ? parseInt(m[1], 10) : 0 };
      })
      .sort((a, b) => b.n - a.n)
      .map((v) => v.name);
    // Always include APP_SHELL_CACHE first (it's the just-activated
    // shell — placeholders may live there from this install run).
    if (!shellNames.includes(APP_SHELL_CACHE)) {
      shellNames.unshift(APP_SHELL_CACHE);
    }
    for (const cacheName of shellNames) {
      const shell = await caches.open(cacheName);
      const keys = await shell.keys();
      for (const key of keys) {
        let keyPath;
        try {
          keyPath = new URL(key.url).pathname;
        } catch {
          continue;
        }
        if (!keyPath.startsWith(prefix)) continue;
        if (keyPath === prefix || keyPath === noTrail) continue;
        // Sibling under the same dynamic prefix — use it as the shell.
        const resp = await shell.match(key);
        if (resp) return resp;
      }
    }
  } catch {}
  return null;
}

// Fetch an HTML page and cache it under both the requested URL and
// (if the server redirected) the final URL. We can't use cache.add()
// for redirected responses — Cache API rejects Response objects with
// the `redirected` flag set, which silently dropped /map, /search,
// /create, etc. on every install because Next.js redirects them to
// their trailingSlash form. Reading the body and constructing a fresh
// Response drops the redirected flag. Returns the asset URLs the HTML
// references so the caller can warm the static cache in the same pass.
async function cacheHtmlPage(shell, url) {
  try {
    const resp = await fetch(url, { redirect: "follow", cache: "no-store" });
    if (!resp.ok) return [];
    const text = await resp.text();
    const buildResp = () => new Response(text, {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
    });
    await shell.put(new Request(url), buildResp()).catch(() => {});
    try {
      const finalUrl = new URL(resp.url);
      const finalPath = finalUrl.pathname + finalUrl.search;
      if (finalPath && finalPath !== url) {
        await shell.put(new Request(finalPath), buildResp()).catch(() => {});
      }
    } catch {}
    return extractAssetUrls(text);
  } catch {
    return [];
  }
}

// Warm the shell + static caches with the CURRENT deploy's HTML, route
// chunks and CSS. Runs at install AND on demand via the "reprecache"
// message: the SW only reinstalls when sw.js's own bytes change, so a
// web-only deploy (new asset hashes, same sw.js) would otherwise never
// proactively cache its new CSS — the client triggers this after each
// deploy so an offline cold-open still renders styled.
async function precacheAppShell() {
  const shell = await caches.open(APP_SHELL_CACHE);
  const staticCache = await caches.open(CACHE_NAME);

  // Static files (logo) — no redirects involved, plain add() is fine.
  await Promise.allSettled(
    APP_SHELL_FILES.map((url) => shell.add(url).catch(() => {}))
  );

  // Pre-cache every page's HTML AND collect their asset URLs in a
  // single pass. Each route has its own JS chunk under
  // /_next/static/chunks/app/<route>/page-<hash>.js — without this
  // warm-up, an offline cold-open could load the HTML but not the
  // route code, leaving the user stuck on a half-rendered page.
  const assetUrls = new Set();
  await Promise.allSettled(APP_SHELL_PAGES.map(async (url) => {
    const urls = await cacheHtmlPage(shell, url);
    urls.forEach((u) => assetUrls.add(u));
  }));

  // Leaflet stylesheet is injected at runtime by IncidentMapInner,
  // so it won't appear in scraped HTML. Cache it explicitly so an
  // offline /map still gets its tile-layer styling.
  assetUrls.add("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");

  await Promise.allSettled(
    Array.from(assetUrls).map((u) => staticCache.add(u).catch(() => {}))
  );
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precacheAppShell());
});

// Matches the versioned static-asset cache names (`peja-v9`, `peja-v10`, ...).
// We retain these across activations so a partial new install can still
// serve old CSS/JS chunks as a fallback. Tailwind class names are
// deterministic, so an older chunk applied to newer HTML is mostly
// correct — far better than the unstyled FOUC users were reporting when
// activate wiped the old cache before the new install had populated.
const STATIC_VERSION_PATTERN = /^peja-v\d+$/;
const SHELL_VERSION_PATTERN = /^peja-shell-v\d+$/;
// Keep up to this many old static caches around as fallbacks. Each
// deploy bumps CACHE_NAME, so this caps long-term storage growth.
const MAX_STATIC_CACHES = 2;
// Same idea for shell caches: holding on to one previous version means
// findDynamicRouteShell can still find a /post/<X>/ or /messages/<X>/
// shell while a new install is mid-flight (or never finished — e.g.
// the user closed the app before the placeholder URLs got cached).
// Without this, every version bump leaves a window where the dynamic
// shell cache is empty and offline navigation falls through to "/".
const MAX_SHELL_CACHES = 2;

self.addEventListener("activate", (event) => {
  const KEEP_EXACT = [CACHE_NAME, APP_SHELL_CACHE, DATA_CACHE, MEDIA_CACHE, VIDEO_CACHE];
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const staticVersions = [];
    const shellVersions = [];
    for (const key of keys) {
      if (KEEP_EXACT.includes(key)) continue;
      if (SHELL_VERSION_PATTERN.test(key)) {
        const m = key.match(/^peja-shell-v(\d+)$/);
        if (m) shellVersions.push({ name: key, n: parseInt(m[1], 10) });
        continue;
      }
      if (STATIC_VERSION_PATTERN.test(key)) {
        const m = key.match(/^peja-v(\d+)$/);
        if (m) staticVersions.push({ name: key, n: parseInt(m[1], 10) });
        continue;
      }
      // Anything else we don't recognize is fair game to delete.
      await caches.delete(key);
    }
    // Prune the oldest static + shell caches, keeping the newest
    // MAX_* of each (the just-activated CACHE_NAME / APP_SHELL_CACHE
    // are already KEEP_EXACT'd so they don't appear in these lists).
    staticVersions.sort((a, b) => b.n - a.n);
    for (const v of staticVersions.slice(MAX_STATIC_CACHES)) {
      await caches.delete(v.name);
    }
    shellVersions.sort((a, b) => b.n - a.n);
    for (const v of shellVersions.slice(MAX_SHELL_CACHES)) {
      await caches.delete(v.name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (NO_CACHE_PATTERNS.some((p) => p.test(request.url))) return;

  // Static assets: cache-first. On total miss (no cache + no network)
  // for CSS specifically, return ANY cached CSS file as a last
  // resort. Wrong-version styling beats a totally unstyled page,
  // which is what users see when a deploy moves to a new CSS hash
  // and they go offline before the new chunk gets fetched.
  if (STATIC_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(
      caches.match(request).then((c) =>
        c || fetch(request).then((r) => {
          if (r.ok) {
            const cl = r.clone();
            caches.open(CACHE_NAME).then((ca) => ca.put(request, cl));
          }
          return r;
        }).catch(async () => {
          if (url.pathname.endsWith(".css")) {
            // Scan ALL versioned static caches (peja-v9, peja-v10, ...)
            // for any cached CSS file. The current CACHE_NAME may be
            // empty mid-install on a deploy transition — falling back
            // across retained old caches keeps Tailwind utilities
            // applied instead of dropping the user into a totally
            // unstyled FOUC.
            const allKeys = await caches.keys();
            for (const cacheName of allKeys) {
              if (!STATIC_VERSION_PATTERN.test(cacheName)) continue;
              const cache = await caches.open(cacheName);
              const entries = await cache.keys();
              for (const entry of entries) {
                if (entry.url.endsWith(".css")) {
                  const cached = await cache.match(entry);
                  if (cached) return cached;
                }
              }
            }
          }
          return new Response("", { status: 408 });
        })
      )
    );
    return;
  }

  // Images: cache-first
  if (IMAGE_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(
      caches.match(request).then((c) => c || fetch(request).then((r) => {
        if (r.ok) { const cl = r.clone(); caches.open(MEDIA_CACHE).then((ca) => ca.put(request, cl)); }
        return r;
      }).catch(() => new Response("", { status: 408 })))
    );
    return;
  }

  // Videos: cache-first
  if (url.hostname.includes("res.cloudinary.com") && url.pathname.includes("/video/")) {
    event.respondWith(
      caches.match(request).then((c) => c || fetch(request).then((r) => {
        if (r.ok) { const cl = r.clone(); caches.open(VIDEO_CACHE).then((ca) => ca.put(request, cl)); }
        return r;
      }).catch(() => new Response("", { status: 408 })))
    );
    return;
  }

  // Offline-failure response for data endpoints. Returning a 503 with a
  // JSON error body — rather than a synthetic `Response("[]")` — means
  // supabase-js's normal error path fires (`data: null, error: {...}`)
  // and every consumer's existing `if (error) return` / try/catch
  // works the way you'd expect. The previous synthetic-empty fallback
  // was the root cause of half of the "page rendered with empty
  // data" / "wiped my cached posts" / "InvalidTime crash" bugs — the
  // client never knew the fetch had actually failed because the
  // response looked like a successful empty query.
  const offlineDataResponse = () =>
    new Response(
      JSON.stringify({ error: "offline", offline: true, message: "Network unavailable" }),
      {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "Content-Type": "application/json",
          "X-Peja-Offline": "true",
        },
      }
    );

  // Supabase data: stale-while-revalidate (read-heavy collections only)
  if (CACHEABLE_DATA_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const net = fetch(request).then((r) => {
          if (r.ok) { const cl = r.clone(); caches.open(DATA_CACHE).then((ca) => ca.put(request, cl)); }
          return r;
        }).catch(() => cached || offlineDataResponse());
        return cached || net;
      })
    );
    return;
  }

  // User-owned Supabase data: network-first to avoid post-save staleness.
  if (NETWORK_FIRST_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(
      fetch(request)
        .then((r) => {
          if (r.ok) { const cl = r.clone(); caches.open(DATA_CACHE).then((ca) => ca.put(request, cl)); }
          return r;
        })
        .catch(() => caches.match(request).then((c) => c || offlineDataResponse()))
    );
    return;
  }

  // API calls: network-first, cache fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).then((r) => {
        if (r.ok) { const cl = r.clone(); caches.open(DATA_CACHE).then((ca) => ca.put(request, cl)); }
        return r;
      }).catch(() => caches.match(request).then((c) => c || new Response(
        JSON.stringify({ error: "offline", offline: true }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      )))
    );
    return;
  }

  // HTML: network-first so new deploys propagate immediately; cache only as offline fallback
  if (request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(request)
        .then((r) => {
          if (r.ok) { const cl = r.clone(); caches.open(APP_SHELL_CACHE).then((ca) => ca.put(request, cl)); }
          return r;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          // Same path, but ignoring the query string. Catches the case
          // where the user navigated to e.g. `/map?post=X&lat=Y` —
          // Cache API stores `/map/` (no query string) so an exact
          // match misses, but the HTML shell is identical regardless
          // of query params (Next.js reads them client-side via
          // useSearchParams). Without this the distance badge / any
          // /static-route?query link fell through to home.
          const cachedIgnoringSearch = await caches.match(request, {
            ignoreSearch: true,
          });
          if (cachedIgnoringSearch) return cachedIgnoringSearch;
          // Dynamic-route shell fallback. Tapping a post / chat /
          // checkin offline used to fall all the way through to the
          // home page HTML, so the user saw the home feed at a
          // /post/<id> URL. The HTML shell under any of these
          // prefixes is interchangeable across IDs — Next.js boots
          // from window.location after hydration — so returning a
          // cached sibling lets the page render for the requested ID
          // (and its own client logic shows the appropriate skeleton
          // + offline error state).
          const dynamicShell = await findDynamicRouteShell(url.pathname);
          if (dynamicShell) return dynamicShell;
          const root = await caches.match("/");
          if (root) return root;
          return new Response(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Peja</title><style>*{box-sizing:border-box}body{background:#0c0818;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif;color:#fff;padding:1rem}</style></head><body><div style="text-align:center;max-width:320px"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="1.5" style="margin-bottom:1rem"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0"/><path d="M12 8v4l3 3"/></svg><p style="color:#a78bfa;font-size:1.1rem;font-weight:600;margin:0 0 .5rem">You're offline</p><p style="color:#6b7280;font-size:.875rem;margin:0 0 1.5rem">Connect to the internet to view this page</p><button onclick="history.back()" style="padding:.6rem 1.5rem;background:#7c3aed;color:#fff;border:none;border-radius:.75rem;font-size:.875rem;cursor:pointer;font-weight:500">Go Back</button></div></body></html>`,
            { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        })
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(request).then((r) => {
      if (r.ok) { const cl = r.clone(); caches.open(CACHE_NAME).then((ca) => ca.put(request, cl)); }
      return r;
    }).catch(() => caches.match(request))
  );
});

// Offline action queue via IndexedDB
const QUEUE_DB = "peja-offline-queue";
const QUEUE_STORE = "actions";

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(QUEUE_STORE))
        req.result.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueAction(action) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).add(action);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function replayQueue() {
  const db = await openQueueDB();
  const actions = await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const action of actions) {
    try {
      const res = await fetch(action.url, { method: action.method, headers: action.headers, body: action.body });
      if (res.ok) {
        const tx = db.transaction(QUEUE_STORE, "readwrite");
        tx.objectStore(QUEUE_STORE).delete(action.id);
      }
    } catch { break; }
  }
}

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
  if (event.data === "clearCache") caches.keys().then((k) => k.forEach((key) => caches.delete(key)));
  // Re-warm the app shell for a new deploy (new CSS/JS hashes) without a SW
  // reinstall. Fired by the client when the deploy version changes.
  if (event.data?.type === "reprecache") event.waitUntil(precacheAppShell());
  if (event.data?.type === "invalidate-data" && typeof event.data.urlContains === "string") {
    const needle = event.data.urlContains;
    caches.open(DATA_CACHE).then((cache) =>
      cache.keys().then((keys) =>
        Promise.all(keys.filter((req) => req.url.includes(needle)).map((req) => cache.delete(req)))
      )
    );
  }
  if (event.data?.type === "queue-action") queueAction(event.data.action);
  if (event.data === "replay-queue") replayQueue();
});

self.addEventListener("sync", (event) => {
  if (event.tag === "peja-offline-sync") event.waitUntil(replayQueue());
});

// ── Web push (iOS Home Screen PWA + desktop browsers) ──
// FCM webpush messages carrying a `notification` payload are displayed
// by the browser itself; this handler covers data-only payloads so
// nothing ever arrives silently.
self.addEventListener("push", (event) => {
  // ALWAYS show something: Safari/iOS never auto-displays (and revokes
  // the subscription if a push produces no notification), and the server
  // sends webpush data-only so Chrome won't double-display.
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = {}; }
  const n = msg.notification || {};
  const data = msg.data || msg || {};
  const title = n.title || data.title || "peja";
  const body = n.body || data.body || "";
  // App-icon badge (iOS 16.4+ Home Screen apps, installed Android PWAs).
  try {
    const badge = Number(data.badge);
    if (Number.isFinite(badge) && "setAppBadge" in self.navigator) {
      if (badge > 0) self.navigator.setAppBadge(badge);
      else self.navigator.clearAppBadge();
    }
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/android-chrome-192x192.png",
      badge: "/android-chrome-192x192.png",
      data: { url: "/notifications" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
