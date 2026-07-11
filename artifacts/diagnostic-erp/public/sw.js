/**
 * ERP Service Worker (v2 — offline-first)
 *
 * Caching strategies:
 *   SPA shell (index.html)               → Precache on install, network-first,
 *                                             fallback to cached when offline
 *   Static assets (hashed Vite output)   → Cache-first (immutable hashes)
 *   API GET requests                     → Stale-while-revalidate (24 h max age)
 *   Mutations + auth + version check     → Network-only (never cached)
 *   Per-staff/per-patient personal data  → Network-only (never cached — Cache
 *   (see NETWORK_ONLY_PREFIXES)             Storage keys by URL only, not by
 *                                             Authorization, so caching any of
 *                                             these would leak one identity's
 *                                             data to the next on a shared
 *                                             workstation/kiosk)
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
  // Every per-staff personal-preference endpoint (e.g. /api/my/quick-doctors)
  // lives under this prefix. Cache Storage keys purely by request URL — it
  // does not vary by the Authorization header — so caching a GET here would
  // let a second staff member on a shared workstation be served the FIRST
  // staff member's cached personal data before the background revalidation
  // fetch completes. Excluding the whole prefix (not just today's one
  // endpoint) means every future /api/my/* route is safe by default.
  "/api/my/",

  // The rest of this list is a repository-wide audit sweep for every OTHER
  // authenticated endpoint that returns data scoped to the calling
  // staff/patient identity rather than a shared resource, found the same way
  // the /api/my/quick-doctors leak was found: same URL, response varies by
  // Authorization, Cache Storage doesn't know the difference. Each entry is
  // scoped as narrowly as its router allows — a whole-router prefix only
  // where EVERY GET on that router is personal; otherwise the exact
  // personal-only path(s), leaving that router's shared/non-personal GETs
  // (templates, catalogs, study data, etc.) cacheable as before.
  "/api/users/me/",                                 // DICOM Q/R saved search presets
  "/api/radiology/report-generator/preferences",     // report formatting preferences
  "/api/radiology/report-generator/style-preferences", // impression/terminology style
  "/api/radiology/report-generator/voice-preferences",  // per-radiologist voice-layer overrides (M1.6B3)
  "/api/radiology-memory/",                          // every GET here is staffId-scoped (impressions/analytics/search/patterns/measurements/classifications)
  "/api/radiology/quick-select/favorites",           // per-radiologist Quick Select favorites
  "/api/radiology/quick-select/learned-patterns",    // per-radiologist learning engine patterns
  "/api/portal/me",                                  // patient portal: profile (GET /me itself) + /me/bills, /me/visits,
                                                      // /me/reports, /me/appointments — all match via this one prefix
                                                      // since "/api/portal/me" is itself a prefix of "/api/portal/me/bills" etc. (PHI)
  "/api/auth/webauthn/credentials",                  // caller's own registered passkeys
  "/api/radiology/user-findings-preferences",        // per-radiologist findings display preferences
  "/api/radiology/user-report-preferences",          // per-radiologist report preferences
  "/api/radiology/knowledge/personal-templates",     // radiologist's own template library
  "/api/radiology/knowledge/favorites",               // radiologist's favorited templates
  "/api/radiology/smart/favorite-sets",              // per-radiologist smart-finding favorite sets
  "/api/teaching-cases/favorites",                   // per-staff favorited teaching cases
  "/api/day-close/my-",                              // per-cashier drawer/closure status — shared billing terminals
  "/api/radiology/user-item-usage",                  // per-radiologist recent-item usage log
  "/api/dicom-workflow/radiologist-queue",           // conditionally personal (?filter=assigned_to_me
                                                      // scopes results by the caller's own radiologist id;
                                                      // other filter values are shared — excluded whole-path
                                                      // since NETWORK_ONLY_PREFIXES matches pathname only,
                                                      // not query strings, so it can't be split by filter value)
  "/api/radiology-diagnostics/",                     // M1.3 Flight Deck: live deployment diagnostics — a cached
                                                      // "HEALTHY" verdict would be a stale lie; always hit the network
];

// Guardrail: artifacts/api-server/src/routes/personalEndpointCacheGuard.test.ts
// scans every route file for GET handlers that reference an authenticated-
// identity marker (subjectId, req.user, req.patient, req.portalUser) and
// fails CI if one isn't listed above (or explicitly reviewed as a shared
// resource in that test's REVIEWED_NOT_PERSONAL list). If you're adding a new
// personal-data endpoint: add it above, then add a matching row to that
// test's KNOWN_PERSONAL_ENDPOINTS — the test will fail until both are done.

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
