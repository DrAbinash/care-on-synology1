import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

// ─────────────────────────────────────────────────────────────────────────────
// GUARDRAIL against the whole bug class behind the Quick Doctor 403 and the
// service worker cross-identity cache leak that followed it (see git history:
// "Fix 403 on Quick Doctor save…" and "Fix CRITICAL: service worker leaks
// personal data across staff/patients…").
//
// The service worker (artifacts/diagnostic-erp/public/sw.js) caches every
// GET /api/* response by URL alone — it cannot know a response is scoped to
// the caller's identity unless a human tells it, by adding that path to
// NETWORK_ONLY_PREFIXES. Nothing stops a future route from returning
// identity-scoped data without that step ever happening again — that IS
// exactly how the original bug shipped.
//
// This test closes that gap two ways:
//
//  1. AUTO-DISCOVERY: scans every route file under artifacts/api-server/src/
//     routes/ for GET handlers whose body references an authenticated-
//     identity marker (subjectId, req.user, req.patient, req.portalUser —
//     the same properties this repo's session middleware populates). Every
//     match found MUST already be listed in KNOWN_PERSONAL_ENDPOINTS below.
//     A new personal-data GET handler that isn't registered here FAILS this
//     test immediately — it cannot silently ship uncached-or-not.
//
//  2. COVERAGE: for every entry in KNOWN_PERSONAL_ENDPOINTS, verifies against
//     the REAL public/sw.js source (not a copy) that its full mounted path is
//     network-only. A future edit to sw.js that drops or breaks a prefix
//     fails this test too.
//
// To add a new personal-data endpoint:
//   a. Add its full mounted path to NETWORK_ONLY_PREFIXES in
//      artifacts/diagnostic-erp/public/sw.js (see the comment block there).
//   b. Add a row to KNOWN_PERSONAL_ENDPOINTS below.
//   c. Run this test — it will fail loudly if either step was skipped.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));
const SW_PATH = join(ROUTES_DIR, "..", "..", "..", "diagnostic-erp", "public", "sw.js");

// Exactly the properties this repo's auth middleware populates with caller
// identity (requireStaffAuth.ts sets req.staffSession.subjectId;
// requirePatientAuth in portal.ts sets req.portalSession.subjectId — the bare
// token "subjectId" catches both), plus the two literal property names named
// in the hardening-pass brief (req.user, req.patient) and req.portalUser for
// forward compatibility, even though a repo-wide scan found no current use of
// any of the three.
const PERSONAL_IDENTITY_MARKERS = ["subjectId", "req.user", "req.patient", "req.portalUser"];

// Every route already verified (2026-07-10 audit) to return data scoped to
// the caller's own identity, and already excluded from Cache Storage in
// public/sw.js. `file` is relative to this routes/ directory; `localPath` is
// the literal string passed to .get(...) in that file; `fullPath` is what the
// browser actually requests (mount prefix + localPath) and what
// NETWORK_ONLY_PREFIXES is checked against.
interface KnownPersonalEndpoint {
  file: string;
  localPath: string;
  fullPath: string;
}

const KNOWN_PERSONAL_ENDPOINTS: KnownPersonalEndpoint[] = [
  { file: "staffQuickDoctors.ts", localPath: "/", fullPath: "/api/my/quick-doctors" },
  { file: "userPreferences.ts", localPath: "/me/dicom-presets", fullPath: "/api/users/me/dicom-presets" },
  { file: "radiology-report-generator.ts", localPath: "/preferences", fullPath: "/api/radiology/report-generator/preferences" },
  { file: "radiology-report-generator.ts", localPath: "/style-preferences", fullPath: "/api/radiology/report-generator/style-preferences" },
  { file: "radiology-report-generator.ts", localPath: "/voice-preferences", fullPath: "/api/radiology/report-generator/voice-preferences" },
  { file: "radiologyMemory.ts", localPath: "/impressions", fullPath: "/api/radiology-memory/impressions" },
  { file: "radiologyMemory.ts", localPath: "/analytics", fullPath: "/api/radiology-memory/analytics" },
  { file: "radiologyMemory.ts", localPath: "/search", fullPath: "/api/radiology-memory/search" },
  { file: "radiologyMemory.ts", localPath: "/patterns", fullPath: "/api/radiology-memory/patterns" },
  { file: "radiologyMemory.ts", localPath: "/measurements", fullPath: "/api/radiology-memory/measurements" },
  { file: "radiologyMemory.ts", localPath: "/classifications", fullPath: "/api/radiology-memory/classifications" },
  { file: "radiologyQuickFindings.ts", localPath: "/favorites", fullPath: "/api/radiology/quick-select/favorites" },
  { file: "radiologyQuickFindings.ts", localPath: "/learned-patterns", fullPath: "/api/radiology/quick-select/learned-patterns" },
  { file: "portal.ts", localPath: "/me", fullPath: "/api/portal/me" },
  { file: "portal.ts", localPath: "/me/bills", fullPath: "/api/portal/me/bills" },
  { file: "portal.ts", localPath: "/me/visits", fullPath: "/api/portal/me/visits" },
  { file: "portal.ts", localPath: "/me/reports", fullPath: "/api/portal/me/reports" },
  { file: "portal.ts", localPath: "/me/appointments", fullPath: "/api/portal/me/appointments" },
  { file: "webauthn.ts", localPath: "/credentials", fullPath: "/api/auth/webauthn/credentials" },
  { file: "radiology.ts", localPath: "/user-findings-preferences", fullPath: "/api/radiology/user-findings-preferences" },
  { file: "radiology.ts", localPath: "/user-report-preferences", fullPath: "/api/radiology/user-report-preferences" },
  { file: "radiologyKnowledge.ts", localPath: "/personal-templates", fullPath: "/api/radiology/knowledge/personal-templates" },
  { file: "radiologyKnowledge.ts", localPath: "/favorites", fullPath: "/api/radiology/knowledge/favorites" },
  { file: "radiologySmartFindings.ts", localPath: "/favorite-sets", fullPath: "/api/radiology/smart/favorite-sets" },
  { file: "teachingCases.ts", localPath: "/favorites", fullPath: "/api/teaching-cases/favorites" },
  { file: "day-close.ts", localPath: "/my-preview", fullPath: "/api/day-close/my-preview" },
  { file: "day-close.ts", localPath: "/my-drawer-status", fullPath: "/api/day-close/my-drawer-status" },
  { file: "day-close.ts", localPath: "/my-list", fullPath: "/api/day-close/my-list" },
  { file: "day-close.ts", localPath: "/my-post-closure-activity", fullPath: "/api/day-close/my-post-closure-activity" },
  // Missed in the original audit sweep: scopes via session.subjectName, not
  // the bare "subjectId" token PERSONAL_IDENTITY_MARKERS looks for — found
  // while diagnosing "My Daily Summary" showing stale data on every visit.
  { file: "my-daily-summary.ts", localPath: "/", fullPath: "/api/dashboard/my-daily-summary" },
  // Patient portal (mobile app): responses are scoped to the verified patient
  // session's phone. The whole /api/patient/ prefix is network-only in sw.js.
  { file: "patientPortal.ts", localPath: "/my-bookings", fullPath: "/api/patient/my-bookings" },
  { file: "patientPortal.ts", localPath: "/my-reports", fullPath: "/api/patient/my-reports" },
  { file: "radiology.ts", localPath: "/user-item-usage", fullPath: "/api/radiology/user-item-usage" },
  { file: "dicomWorkflow.ts", localPath: "/radiologist-queue", fullPath: "/api/dicom-workflow/radiologist-queue" },
  // M1.3 Flight Deck: the report body is shared deployment truth, not
  // caller-scoped (staffSession only attributes the audit entry) — but live
  // diagnostics must NEVER be answered from Cache Storage: a stale cached
  // "HEALTHY" verdict is precisely the lie the toolkit exists to prevent.
  // The whole /api/radiology-diagnostics/ prefix is network-only in sw.js.
  { file: "radiology-diagnostics.ts", localPath: "/report", fullPath: "/api/radiology-diagnostics/report" },
];

// GET handlers reviewed and confirmed to be SHARED clinical/administrative
// resources, not personal data — a matcher token appears in the same file
// (usually in an adjacent POST/PATCH handler that stamps who performed a
// write) but not because the GET response is caller-scoped. Listed
// explicitly, with the reason, so this test's false-positive rate stays at
// zero without silently widening the marker window.
const REVIEWED_NOT_PERSONAL: Array<{ file: string; localPath: string; reason: string }> = [
  { file: "smartRadiology.ts", localPath: "/ai-impressions/:studyId", reason: "study-scoped, shared across any radiologist viewing the study; subjectId only appears in the adjacent PATCH .../verify handler" },
  { file: "dicomWorkflow.ts", localPath: "/ocr-review/:studyId", reason: "study-scoped, shared; subjectId only appears in the adjacent POST .../accept handler" },
  { file: "radiology.ts", localPath: "/locks", reason: "admin view of ALL active locks across all users, not caller-scoped" },
  { file: "radiology.ts", localPath: "/studies/:id/lock", reason: "study-scoped lock status; isMine differs per caller but this is a shared clinical concurrency resource, not personal preference data — flagged separately in the audit report, not a cache-exclusion candidate" },
  { file: "banking.ts", localPath: "/export", reason: "response is scoped only by accountId/fromDate/toDate query params (shared bank-transaction export, gated by banking permission, not by caller identity); subjectId appears only in a fire-and-forget audit-log write (void auditFromRequest(...)) issued AFTER res.json() has already sent the response" },
  { file: "risMonitoring.ts", localPath: "/audit-export", reason: "admin-only (requireAdmin) shared audit-log export, response scoped only by from/to/user/studyId query params, not caller identity; subjectId appears only in a fire-and-forget audit-log write issued AFTER res.send(csv) has already sent the response" },
  { file: "patient-reports.ts", localPath: "/:id/print", reason: "report-scoped HTML identical for every staff caller (router-level requireStaffAuth gates access); subjectId appears only as the actor identity in the D8 requested-vs-delivered delivery audit record — the response never varies by caller" },
  { file: "patient-reports.ts", localPath: "/:id/pdf", reason: "same as /:id/print — report-scoped HTML; subjectId only feeds the D8 delivery audit record, never the response body" },
];

function loadServiceWorkerSandbox(): Record<string, any> {
  const source = readFileSync(SW_PATH, "utf8");
  const sandbox: Record<string, any> = { self: { addEventListener: () => {} } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: SW_PATH });
  return sandbox;
}

interface DiscoveredHandler {
  file: string;
  method: string;
  localPath: string;
}

// Route registrations with a string-literal path — these are the candidates
// (GET ones get scanned for personal-identity markers).
const ROUTE_CALL = /\b\w+\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]*)["'`]/g;
// .use(...) calls in ANY form (string+middleware, bare middleware function,
// etc.) — not a route candidate itself, but a REQUIRED boundary marker: a
// route file's handler body ends at the next .use()/.get()/.post()/etc. call,
// whichever comes first. Without this, a file mixing many .use() mounts
// between .get() calls (routes/index.ts has 129) lets one handler's "body"
// window bleed across hundreds of unrelated lines and pick up an unrelated
// subjectId reference — exactly the false positive this test hit on
// "/clinic-settings/branding" (a public, unauthenticated handler) during
// development, before this boundary fix.
const USE_CALL = /\b\w+\.use\(/g;

/** Scans one route file's source for every Express route registration, and
 * returns the GET ones whose handler body (up to the next route
 * registration OR .use() call in the same file) contains a personal-
 * identity marker. */
function findPersonalGetHandlers(source: string): DiscoveredHandler[] {
  const routeCalls: Array<{ method: string; localPath: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  ROUTE_CALL.lastIndex = 0;
  while ((m = ROUTE_CALL.exec(source)) !== null) {
    routeCalls.push({ method: m[1], localPath: m[2], start: m.index, bodyStart: m.index + m[0].length });
  }

  const boundaries: number[] = [];
  USE_CALL.lastIndex = 0;
  while ((m = USE_CALL.exec(source)) !== null) boundaries.push(m.index);
  for (const c of routeCalls) boundaries.push(c.start);
  boundaries.sort((a, b) => a - b);

  const found: DiscoveredHandler[] = [];
  for (const call of routeCalls) {
    if (call.method !== "get") continue;
    const nextBoundary = boundaries.find((b) => b > call.start);
    const bodyEnd = nextBoundary ?? source.length;
    const body = source.slice(call.bodyStart, bodyEnd);
    if (PERSONAL_IDENTITY_MARKERS.some((marker) => body.includes(marker))) {
      found.push({ file: "", method: call.method, localPath: call.localPath });
    }
  }
  return found;
}

describe("personal-endpoint cache guard — every identity-scoped GET must be excluded from Cache Storage", () => {
  const routeFiles = readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("scanned at least the expected number of route files (sanity check the scan actually ran)", () => {
    expect(routeFiles.length).toBeGreaterThan(50);
  });

  it("every GET handler referencing a personal-identity marker is a KNOWN, registered, sw.js-excluded endpoint", () => {
    const undocumented: string[] = [];
    for (const file of routeFiles) {
      const source = readFileSync(join(ROUTES_DIR, file), "utf8");
      const handlers = findPersonalGetHandlers(source);
      for (const h of handlers) {
        const known = KNOWN_PERSONAL_ENDPOINTS.some((k) => k.file === file && k.localPath === h.localPath);
        const reviewed = REVIEWED_NOT_PERSONAL.some((r) => r.file === file && r.localPath === h.localPath);
        if (!known && !reviewed) {
          undocumented.push(
            `${file}: GET "${h.localPath}" references a personal-identity marker but is not in ` +
            `KNOWN_PERSONAL_ENDPOINTS (protected in sw.js) or REVIEWED_NOT_PERSONAL (confirmed shared). ` +
            `Add its full mounted path to NETWORK_ONLY_PREFIXES in public/sw.js, then register it in ` +
            `this test's KNOWN_PERSONAL_ENDPOINTS — or, if it is genuinely a shared resource, add it to ` +
            `REVIEWED_NOT_PERSONAL with a reason.`,
          );
        }
      }
    }
    expect(undocumented, undocumented.join("\n\n")).toEqual([]);
  });

  it("every KNOWN_PERSONAL_ENDPOINTS row still exists as a real GET handler in its named file", () => {
    // Catches registry rot: a route renamed or removed without updating this list.
    const missing: string[] = [];
    for (const entry of KNOWN_PERSONAL_ENDPOINTS) {
      const source = readFileSync(join(ROUTES_DIR, entry.file), "utf8");
      const handlers = findPersonalGetHandlers(source);
      const stillMarkedPersonal = handlers.some((h) => h.localPath === entry.localPath);
      // Also allow the case where the marker was removed but the route
      // itself still exists (still worth excluding defensively) — only flag
      // if the ROUTE ITSELF is gone.
      const allCalls = source.match(new RegExp(`\\.get\\(\\s*["'\`]${entry.localPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`));
      if (!stillMarkedPersonal && !allCalls) {
        missing.push(`${entry.file}: GET "${entry.localPath}" (registered as personal) no longer found in this file`);
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("every KNOWN_PERSONAL_ENDPOINTS full path is network-only in the REAL public/sw.js", () => {
    const sandbox = loadServiceWorkerSandbox();
    const unprotected = KNOWN_PERSONAL_ENDPOINTS
      .filter((entry) => !sandbox.isNetworkOnly({ pathname: entry.fullPath }))
      .map((entry) => `${entry.fullPath} (${entry.file}: "${entry.localPath}")`);
    expect(unprotected, unprotected.join("\n")).toEqual([]);
  });
});
