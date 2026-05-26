// Peja Service Worker v9 - Offline-First Safety App
const CACHE_NAME = "peja-v9";
const APP_SHELL_CACHE = "peja-shell-v9";
// Bumped to v6 to invalidate stale /rest/v1/messages and conversations
// responses. Like posts before them (v5 bump), they're now network-first
// so user mutations (clear chat, delete message, block) reflect on the
// next read instead of waiting for SWR to background-refresh.
const DATA_CACHE = "peja-data-v6";
const MEDIA_CACHE = "peja-media-v3";
const VIDEO_CACHE = "peja-video-v3";

const APP_SHELL = [
  "/",
  "/map",
  "/search",
  "/create",
  "/profile",
  "/notifications",
  "/messages",
  "/login",
  "/signup",
  "/settings",
  "/emergency-contacts",
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

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const shell = await caches.open(APP_SHELL_CACHE);
    await Promise.allSettled(
      APP_SHELL.map((url) => shell.add(url).catch(() => {}))
    );
    // Warm the static cache with the chunks the root HTML references
    // so an offline-first cold open doesn't render unstyled. Hashed
    // filenames mean we can't list them statically — fetch them at
    // install time. Also warm /map's chunks (Leaflet CSS moved off the
    // root, so /map has its own asset set now). Best-effort; failures
    // are silent.
    try {
      const staticCache = await caches.open(CACHE_NAME);
      const pages = ["/", "/map"];
      const allUrls = new Set();
      await Promise.allSettled(pages.map(async (p) => {
        try {
          const resp = await fetch(p, { cache: "no-store" });
          if (!resp.ok) return;
          const html = await resp.text();
          extractAssetUrls(html).forEach((u) => allUrls.add(u));
        } catch {}
      }));
      // Leaflet stylesheet is injected at runtime by IncidentMapInner,
      // so it won't appear in the scraped HTML. Cache it explicitly so
      // an offline /map still gets its tile-layer styling.
      allUrls.add("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
      await Promise.allSettled(
        Array.from(allUrls).map((u) => staticCache.add(u).catch(() => {}))
      );
    } catch {}
  })());
});

self.addEventListener("activate", (event) => {
  const KEEP = [CACHE_NAME, APP_SHELL_CACHE, DATA_CACHE, MEDIA_CACHE, VIDEO_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
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
            const cache = await caches.open(CACHE_NAME);
            const keys = await cache.keys();
            for (const key of keys) {
              if (key.url.endsWith(".css")) {
                const cached = await cache.match(key);
                if (cached) return cached;
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

  // Supabase data: stale-while-revalidate (read-heavy collections only)
  if (CACHEABLE_DATA_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const net = fetch(request).then((r) => {
          if (r.ok) { const cl = r.clone(); caches.open(DATA_CACHE).then((ca) => ca.put(request, cl)); }
          return r;
        }).catch(() => cached || new Response("[]", { headers: { "Content-Type": "application/json" } }));
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
        .catch(() => caches.match(request).then((c) => c || new Response("[]", { headers: { "Content-Type": "application/json" } })))
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