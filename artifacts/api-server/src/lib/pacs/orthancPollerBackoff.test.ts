import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Orthanc changes poller — unreachable-Orthanc behaviour.
//
// Production logged this every 20 seconds, forever:
//   orthanc-poller: GET failed — getaddrinfo ENOTFOUND care-orthanc
// ~4,320 warn lines with full stacks per day, into an unrotated Docker
// json-file log on the NAS volume. Not user-facing breakage, but a slow silent
// disk fill AND it buried any genuine intermittent PACS error among thousands
// of identical ones.
//
// Root cause is topology, not code: care-pacs is a SEPARATE compose project on
// its own bridge network, so `care-orthanc` does not resolve from care-api. The
// study sync that actually works is care-erp-sync (care_erp_sync.py), which
// runs inside care-pacs — and whose own header instructs setting
// ORTHANC_CHANGES_POLLER=false in the ERP to avoid double-sync. That switch was
// read by the code but never passed into the container, so it could not be set.
//
// Two things pinned here: the switch is plumbed, and the poller degrades
// gracefully (bounded backoff, warn-once) instead of hot-looping at warn level.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..", "..", "..", "..");

const poller = readFileSync(join(__dirname, "orthancChangesPoller.ts"), "utf8");
const compose = readFileSync(join(REPO, "docker-compose.yml"), "utf8");

describe("poller backs off when Orthanc is unreachable", () => {
  test("bounded exponential backoff with a cap", () => {
    expect(poller).toContain("const BACKOFF_BASE_MS = 60_000;");
    expect(poller).toContain("const BACKOFF_MAX_MS = 30 * 60_000;");
    expect(poller).toContain("Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1))");
  });

  test("the tick actually honours the backoff window", () => {
    expect(poller).toContain("if (inBackoff()) return;");
    // Backoff is inert until a failure occurs, so normal operation is unchanged.
    expect(poller).toContain("return nextAttemptAt > 0 && Date.now() < nextAttemptAt;");
  });

  test("warnings are throttled, not emitted every tick", () => {
    // Log the 1st, 2nd, 4th, 8th… failure only.
    expect(poller).toContain("const isPowerOfTwo = (consecutiveFailures & (consecutiveFailures - 1)) === 0;");
    expect(poller).toContain("suppressedWarnings");
    // The old unconditional per-tick warn must be gone.
    expect(poller).not.toContain('logger.warn({ err, path }, "orthanc-poller: GET failed");');
  });

  test("recovery resets state and says so once", () => {
    expect(poller).toContain("orthanc-poller: Orthanc reachable again");
    expect(poller).toContain("consecutiveFailures = 0;");
  });

  test("a non-2xx counts as REACHABLE and keeps its own warning", () => {
    // Orthanc answering with 4xx/5xx is a real actionable error, distinct from
    // the absent-container case — it must not be swallowed by the backoff.
    expect(poller).toContain('logger.warn({ path, status: resp.status }, "orthanc-poller: GET non-2xx");');
    const nonOk = poller.indexOf("if (!resp.ok)");
    const reachableCall = poller.indexOf("noteReachable();", nonOk);
    expect(reachableCall).toBeGreaterThan(nonOk);
  });
});

describe("the double-sync kill switch is reachable from deployment", () => {
  test("ORTHANC_CHANGES_POLLER is passed into the api container", () => {
    expect(compose).toContain("ORTHANC_CHANGES_POLLER: ${ORTHANC_CHANGES_POLLER:-}");
  });

  test("the poll interval is configurable too", () => {
    expect(compose).toContain("ORTHANC_POLL_INTERVAL_MS: ${ORTHANC_POLL_INTERVAL_MS:-}");
  });

  test("the code still honours the switch", () => {
    expect(poller).toContain('process.env.ORTHANC_CHANGES_POLLER === "false"');
    expect(poller).toContain('process.env.ORTHANC_CHANGES_POLLER === "0"');
  });
});
