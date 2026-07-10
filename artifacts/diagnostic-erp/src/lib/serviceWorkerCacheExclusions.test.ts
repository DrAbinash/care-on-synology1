import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

// Regression coverage for a CRITICAL production finding: the service worker's
// stale-while-revalidate API cache (public/sw.js) keys Cache Storage entries
// by request URL only — it does not vary by the Authorization header. Any
// per-staff personal-data GET endpoint (e.g. /api/my/quick-doctors) left out
// of NETWORK_ONLY_PREFIXES would let a second staff member on a shared
// hospital workstation be served the FIRST staff member's cached response
// before the background revalidation fetch completes.
//
// This test evaluates the REAL public/sw.js source (not a reimplementation
// or a copy of NETWORK_ONLY_PREFIXES) in a minimal sandbox, so a future edit
// that silently removes the "/api/my/" entry — or reorders the fetch
// listener's checks so isNetworkOnly no longer runs first — fails this test,
// not just a hand-maintained duplicate list.

const here = dirname(fileURLToPath(import.meta.url));
const SW_PATH = join(here, "..", "..", "public", "sw.js");

function loadServiceWorkerSandbox(): Record<string, any> {
  const source = readFileSync(SW_PATH, "utf8");
  // sw.js is a classic (non-module) script — self.addEventListener,
  // caches.open, etc. are only ever invoked from inside event listener
  // callbacks, which nothing here triggers. Stubbing `self` as a no-op
  // listener target is enough to let the file's top-level function
  // declarations (isNetworkOnly, isApiGet, isStaticAsset, isShellRequest)
  // evaluate and attach to the sandbox context — `const`/`let` top-level
  // declarations do NOT attach to a vm context object, but `function`
  // declarations do, which is exactly what this test needs.
  const sandbox: Record<string, any> = { self: { addEventListener: () => {} } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: SW_PATH });
  return sandbox;
}

describe("public/sw.js — NETWORK_ONLY_PREFIXES excludes /api/my/* (shared-workstation cache leak fix)", () => {
  const sandbox = loadServiceWorkerSandbox();

  it("exposes isNetworkOnly as a real function extracted from the actual file", () => {
    expect(typeof sandbox.isNetworkOnly).toBe("function");
  });

  it("treats /api/my/quick-doctors as network-only (never cached)", () => {
    expect(sandbox.isNetworkOnly({ pathname: "/api/my/quick-doctors" })).toBe(true);
  });

  it("treats ANY future /api/my/* endpoint as network-only, not just today's one path", () => {
    expect(sandbox.isNetworkOnly({ pathname: "/api/my/notification-preferences" })).toBe(true);
    expect(sandbox.isNetworkOnly({ pathname: "/api/my/dashboard-layout" })).toBe(true);
    expect(sandbox.isNetworkOnly({ pathname: "/api/my/anything-not-yet-built" })).toBe(true);
  });

  it("does not over-broaden the exclusion to unrelated /api/myopia-clinic-style paths", () => {
    // Guards against a naive prefix like "/api/my" (no trailing slash) that
    // would also match unrelated paths merely starting with those letters.
    expect(sandbox.isNetworkOnly({ pathname: "/api/mystery-endpoint" })).toBe(false);
  });

  it("still treats the pre-existing network-only routes as network-only (no regression)", () => {
    expect(sandbox.isNetworkOnly({ pathname: "/api/login" })).toBe(true);
    expect(sandbox.isNetworkOnly({ pathname: "/api/logout" })).toBe(true);
    expect(sandbox.isNetworkOnly({ pathname: "/api/version" })).toBe(true);
  });

  it("leaves unrelated, legitimately-cacheable API GETs untouched (no over-broadening)", () => {
    expect(sandbox.isNetworkOnly({ pathname: "/api/clinic-settings" })).toBe(false);
    expect(sandbox.isNetworkOnly({ pathname: "/api/clinic-settings/branding" })).toBe(false);
    expect(sandbox.isNetworkOnly({ pathname: "/api/doctors" })).toBe(false);
  });

  // Repository-wide audit sweep: every other authenticated endpoint found to
  // return caller-identity-scoped data (not a shared resource), same leak
  // class as /api/my/quick-doctors. Each assertion pins one real, verified
  // route so a future edit that silently drops the entry fails this test.
  it("protects every other personal-data endpoint found in the repository audit", () => {
    const personalPaths = [
      "/api/users/me/dicom-presets",
      "/api/radiology/report-generator/preferences",
      "/api/radiology/report-generator/style-preferences",
      "/api/radiology-memory/impressions",
      "/api/radiology-memory/analytics",
      "/api/radiology-memory/search",
      "/api/radiology-memory/patterns",
      "/api/radiology-memory/measurements",
      "/api/radiology-memory/classifications",
      "/api/radiology/quick-select/favorites",
      "/api/radiology/quick-select/learned-patterns",
      "/api/portal/me",
      "/api/portal/me/bills",
      "/api/portal/me/visits",
      "/api/portal/me/reports",
      "/api/portal/me/appointments",
      "/api/auth/webauthn/credentials",
      "/api/radiology/user-findings-preferences",
      "/api/radiology/user-report-preferences",
      "/api/radiology/knowledge/personal-templates",
      "/api/radiology/knowledge/favorites",
      "/api/radiology/smart/favorite-sets",
      "/api/teaching-cases/favorites",
      "/api/day-close/my-preview",
      "/api/day-close/my-drawer-status",
      "/api/day-close/my-list",
      "/api/day-close/my-post-closure-activity",
    ];
    for (const pathname of personalPaths) {
      expect(sandbox.isNetworkOnly({ pathname }), `expected "${pathname}" to be network-only`).toBe(true);
    }
  });

  it("does not over-broaden the personal-endpoint exclusions onto that same router's shared/non-personal GETs", () => {
    // /api/radiology/quick-select owns both personal (favorites/learned-patterns)
    // and shared (study tabs, finding catalog) GETs — only the personal ones
    // should be network-only.
    expect(sandbox.isNetworkOnly({ pathname: "/api/radiology/quick-select/tabs" })).toBe(false);
    // /api/radiology/knowledge owns both personal-templates/favorites and
    // shared master templates / knowledge base search.
    expect(sandbox.isNetworkOnly({ pathname: "/api/radiology/knowledge/master-templates" })).toBe(false);
    // /api/radiology/report-generator owns both preferences and shared draft/
    // template endpoints.
    expect(sandbox.isNetworkOnly({ pathname: "/api/radiology/report-generator/drafts" })).toBe(false);
    // /api/day-close owns both per-cashier /my-* endpoints and shared overall
    // closure status.
    expect(sandbox.isNetworkOnly({ pathname: "/api/day-close/status" })).toBe(false);
    // /api/portal owns both /me/* patient-personal data and public/shared
    // portal configuration.
    expect(sandbox.isNetworkOnly({ pathname: "/api/portal/branding" })).toBe(false);
  });

  it("the fetch listener checks isNetworkOnly() BEFORE the API-GET stale-while-revalidate branch", () => {
    // Structural guard: even a correct NETWORK_ONLY_PREFIXES list is useless
    // if a future refactor reorders the fetch handler so isApiGet's
    // staleWhileRevalidate branch runs first. This asserts the ordering
    // directly against the real file's source.
    const source = readFileSync(SW_PATH, "utf8");
    const networkOnlyCheckIdx = source.indexOf("if (isNetworkOnly(url)) return;");
    const staleWhileRevalidateCallIdx = source.indexOf("event.respondWith(staleWhileRevalidate(");
    expect(networkOnlyCheckIdx).toBeGreaterThan(-1);
    expect(staleWhileRevalidateCallIdx).toBeGreaterThan(-1);
    expect(networkOnlyCheckIdx).toBeLessThan(staleWhileRevalidateCallIdx);
  });
});
