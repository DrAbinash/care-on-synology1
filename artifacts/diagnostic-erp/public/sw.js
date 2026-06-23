/**
 * ERP Service Worker (v2 — offline-first)
 *
 * Caching strategies:
 *   SPA shell (index.html)               → Precache on install, network-first,
 *                                             fallback to cached when offline
 *   Static assets (hashed Vite output)   → Cache-first (immutable hashes)
 *   API GET requests                     → Stale-while-revalidate (24 h max age)
 *   Mutations + auth + version check     → Network-only (never cached)
 *   SPA navigation (non-asset GET)       → Offline: serve cached index.html
 *
 * This SW makes the desktop/Electron build truly offline-capable:
 * reopening the browser while disconnected still loads the full ERP shell,
 * which then shows cached data and an offline indicator.
 */

const STATIC_CACHE = "erp-static-v2";
const API_CACHE    = "erp-api-v2";
const SHELL_CACHE  = "erp-shell-v2";

const MAX_API_AGE_MS = 24 * 60 * 60 * 1000;

// Paths that must ALWAYS hit the real network
const NETWORK_ONLY_PREFIXES = [
  "/api/version",
  "/api/login",
  "/api/logout",
  "/api/super-admin/login",
  "/api/super-admin/usb",
  "/api/backup",
  "/api/system",
  "/api/sync/push",
  "/api/sync/pull",
  "/api/sync/trigger",
];

// Paths that should NOT be redirected to index.html (real files/API)
const SKIP_SHELL_PATHS = [
  "/assets/",
  "/api/",
  "/uploads/",
  "/favicon",
  "/opengraph",
  "/sw.js",
  "/manifest",
  ".js", ".css", ".woff2", ".woff", ".ttf", ".svg", ".png", ".jpg", ".jpeg", ".ico", ".json",
];

function isNetworkOnly(url) {
  return NETWORK_ONLY_PREFIXES.some((p) => url.pathname.startsWith(p));
}

function isApiGet(request, url) {
  return request.method === "GET" && url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  const p = url.pathname;
  return (
    p.includes("/assets/") ||
    p.endsWith(".js")  ||
    p.endsWith(".css") ||
    p.endsWith(".woff2") ||
    p.endsWith(".woff")  ||
    p.endsWith(".ttf")   ||
    p.endsWith(".svg")   ||
    p.endsWith(".png")   ||
    p.endsWith(".ico")
  );
}

function isShellRequest(request, url) {
  // SPA navigation: GET, same-origin, not a static file, not an API call
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    !isStaticAsset(url) &&
    !isApiGet(request, url) &&
    !SKIP_SHELL_PATHS.some((s) => url.pathname.includes(s))
  );
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  // Precache the SPA shell so it is available offline immediately
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add("./index.html"))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Remove old caches
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => ![STATIC_CACHE, API_CACHE, SHELL_CACHE].includes(k))
            .map((k) => caches.delete(k))
        )
      ),
    ])
  );
});

// ─── Fetch interception ──────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept same-origin requests
  if (url.origin !== self.location.origin) return;

  // Let all non-GET requests pass through unchanged
  if (request.method !== "GET") return;

  // Explicitly network-only routes
  if (isNetworkOnly(url)) return;

  // API reads → stale-while-revalidate
  if (isApiGet(request, url)) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE, MAX_API_AGE_MS));
    return;
  }

  // Versioned static assets → cache-first
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // SPA navigation → network-first, fallback to cached index.html when offline
  if (isShellRequest(request, url)) {
    event.respondWith(networkFirstShell(request));
    return;
  }
});

// ─── Strategies ─────────────────────────────────────────────────────────────────────────────

async function staleWhileRevalidate(request, cacheName, maxAgeMs) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchAndStore = async () => {
    try {
      const response = await fetch(request.clone());
      if (response.ok) {
        const body    = await response.clone().arrayBuffer();
        const headers = new Headers(response.headers);
        headers.set("x-sw-cached-at", String(Date.now()));
        const stored = new Response(body, {
          status:     response.status,
          statusText: response.statusText,
          headers,
        });
        await cache.put(request, stored);
      }
      return response;
    } catch {
      return null;
    }
  };

  if (cached) {
    const cachedAt = Number(cached.headers.get("x-sw-cached-at") ?? "0");
    const age      = Date.now() - cachedAt;

    if (age < maxAgeMs) {
      void fetchAndStore();
      return cached;
    }
  }

  const fresh = await fetchAndStore();
  if (fresh)  return fresh;
  if (cached) return cached;

  return new Response(
    JSON.stringify({ error: "offline", message: "No cached data available." }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}

async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

/**
 * Network-first shell strategy:
 *   1. Try to fetch index.html from the network.
 *   2. If successful, cache it and return it.
 *   3. If offline, return the cached index.html (SPA shell).
 *   4. If neither exists, return a minimal offline HTML page.
 *
 * This lets the SPA boot and render the offline indicator even when
 * the browser is opened without any network connection.
 */
async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const fresh = await fetch("./index.html");
    if (fresh.ok) {
      const clone = fresh.clone();
      await cache.put("./index.html", clone);
      return fresh;
    }
  } catch {
    // Network failure — fall through to cached copy
  }

  const cached = await cache.match("./index.html");
  if (cached) return cached;

  // Absolute fallback: minimal HTML that the SPA can mount into
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Care Diagnostics</title>
<style>body{font-family:system-ui;margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#fff}
#root{text-align:center}
h1{margin:0 0 .5rem;font-size:1.5rem}
p{margin:0;color:#94a3b8}
</style></head>
<body><div id="root"><h1>Care Diagnostics</h1><p>Offline — no cached shell available.</p></div></body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
