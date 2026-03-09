// Peja Service Worker - Aggressive App Shell Caching
const CACHE_NAME = "peja-v1";
const APP_SHELL_CACHE = "peja-shell-v1";
const DATA_CACHE = "peja-data-v1";

// App shell files to pre-cache on install
const APP_SHELL = [
  "/",
  "/map/",
  "/search/",
  "/create/",
  "/profile/",
  "/notifications/",
  "/messages/",
  "/login/",
  "/signup/",
  "/settings/",
  "/offline.html",
];

// Patterns that should be cached aggressively (static assets)
const STATIC_PATTERNS = [
  /\/_next\/static\/.*/,
  /\.(?:js|css|woff2?|ttf|eot)$/,
  /\.(?:png|jpg|jpeg|gif|svg|ico|webp)$/,
];

// Patterns that should NEVER be cached (API calls, real-time data)
const NO_CACHE_PATTERNS = [
  /\/api\//,
  /supabase\.co/,
  /googleapis\.com/,
  /nominatim\.openstreetmap\.org/,
  /cloudinary\.com\/.*\/upload/,
  /res\.cloudinary\.com/,
  /firebase/,
];

// Install: pre-cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => {
        // Don't fail install if some pages fail to cache
        return Promise.allSettled(
          APP_SHELL.map((url) =>
            cache.add(url).catch((err) => {
              console.warn("SW: Failed to cache", url, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== APP_SHELL_CACHE &&
                key !== CACHE_NAME &&
                key !== DATA_CACHE
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: stale-while-revalidate for pages, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip API and data requests - always go to network
  if (NO_CACHE_PATTERNS.some((pattern) => pattern.test(request.url))) return;

  // Static assets: cache-first (they have content hashes)
  if (STATIC_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => caches.match("/offline.html"));
      })
    );
    return;
  }

  // HTML pages: stale-while-revalidate
  if (
    request.mode === "navigate" ||
    request.headers.get("accept")?.includes("text/html")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches
                .open(APP_SHELL_CACHE)
                .then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => {
            // Network failed, return cached version or offline page
            return cached || caches.match("/offline.html");
          });

        // Return cached immediately if available, update in background
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Listen for update messages
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
  if (event.data === "clearCache") {
    caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
  }
});
