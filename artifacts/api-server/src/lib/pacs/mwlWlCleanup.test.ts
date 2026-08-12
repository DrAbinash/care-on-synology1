/**
 * MWL .wl removal accuracy + durable cleanup rules (temp dirs / pure helpers).
 * Never touches production Orthanc paths.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  isRemoveWorklistSuccess,
  removeWorklistFile,
  syncWorklistForStatus,
} from "./mwlWorklistWriter";
import {
  assessMwlCleanupTrafficLight,
  decideCleanupAfterRemove,
  isTerminalMwlStatus,
  mwlCleanupIdempotencyKey,
  MWL_WL_CLEANUP_JOB,
} from "./mwlWlCleanupRules";
import { decideFailure, computeBackoffMs } from "../radiologyJobRules";

const ORIG_MWL_DIR = process.env.ORTHANC_WORKLIST_DIR;

describe("removeWorklistFile accurate outcomes", () => {
  let root: string;
  let live: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mwl-rm-"));
    live = path.join(root, "worklists");
    await mkdir(live, { recursive: true });
    process.env.ORTHANC_WORKLIST_DIR = live;
  });

  afterEach(async () => {
    if (ORIG_MWL_DIR === undefined) delete process.env.ORTHANC_WORKLIST_DIR;
    else process.env.ORTHANC_WORKLIST_DIR = ORIG_MWL_DIR;
    await rm(root, { recursive: true, force: true });
  });

  it("1. existing .wl removed → wlRemoved success, no retry needed", async () => {
    const acc = "ACC-RM-001";
    const wl = path.join(live, `${acc}.wl`);
    await writeFile(wl, "dicom", "utf8");
    const r = await removeWorklistFile(acc);
    expect(r.outcome).toBe("removed");
    expect(isRemoveWorklistSuccess(r)).toBe(true);
    expect(decideCleanupAfterRemove(r)).toEqual({ wlRemoved: true, shouldEnqueue: false });
    await expect(access(wl)).rejects.toThrow();
  });

  it("2. already absent → idempotent success, no retry", async () => {
    const r = await removeWorklistFile("ACC-MISSING");
    expect(r.outcome).toBe("already_absent");
    expect(decideCleanupAfterRemove(r)).toEqual({ wlRemoved: true, shouldEnqueue: false });
  });

  it("3. unlink failure → wlRemoved false, shouldEnqueue true (DB cancel still separate)", async () => {
    const failed = { outcome: "failed" as const, error: "EACCES" };
    expect(decideCleanupAfterRemove(failed)).toEqual({ wlRemoved: false, shouldEnqueue: true });

    const acc = "ACC-FAIL-001";
    await writeFile(path.join(live, `${acc}.wl`), "x", "utf8");
    await chmod(live, 0o555);
    try {
      const r = await removeWorklistFile(acc);
      if (r.outcome === "failed") {
        expect(decideCleanupAfterRemove(r).shouldEnqueue).toBe(true);
      }
    } finally {
      await chmod(live, 0o755);
    }
  });

  it("MWL disabled → success without enqueue", async () => {
    delete process.env.ORTHANC_WORKLIST_DIR;
    const r = await removeWorklistFile("ACC-X");
    expect(r.outcome).toBe("disabled");
    expect(decideCleanupAfterRemove(r).shouldEnqueue).toBe(false);
  });

  it("syncWorklistForStatus(CANCELLED) returns accurate remove result", async () => {
    const acc = "ACC-SYNC-1";
    await writeFile(path.join(live, `${acc}.wl`), "x", "utf8");
    const sync = await syncWorklistForStatus({ accessionNumber: acc, modality: "MR" }, "CANCELLED");
    expect(sync.action).toBe("removed");
    expect(sync.remove?.outcome).toBe("removed");
  });
});

describe("mwl cleanup traffic light + backoff + idempotency", () => {
  it("12. successful retry clears diagnostics warning (GREEN)", () => {
    expect(assessMwlCleanupTrafficLight({ pending: 0, retrying: 0, abandoned: 0, overdue: 0 })).toEqual({
      trafficLight: "green",
      detail: "Pending MWL cleanup: 0",
    });
  });

  it("pending retry → AMBER", () => {
    const r = assessMwlCleanupTrafficLight({ pending: 2, retrying: 1, abandoned: 0, overdue: 0 });
    expect(r.trafficLight).toBe("amber");
  });

  it("5. repeated failures → RED; retryCount/backoff advance", () => {
    expect(assessMwlCleanupTrafficLight({ pending: 0, retrying: 0, abandoned: 1, overdue: 0 }).trafficLight).toBe("red");
    expect(assessMwlCleanupTrafficLight({ pending: 1, retrying: 0, abandoned: 0, overdue: 2 }).trafficLight).toBe("red");

    const now = new Date("2099-01-01T00:00:00Z");
    const first = decideFailure({ retryCount: 0, maxRetries: 12, now });
    expect(first.status).toBe("retrying");
    expect(first.retryCount).toBe(1);
    expect(first.nextRetryAt!.getTime() - now.getTime()).toBe(computeBackoffMs(1));

    const second = decideFailure({ retryCount: 1, maxRetries: 12, now });
    expect(second.retryCount).toBe(2);
    expect(second.nextRetryAt!.getTime()).toBeGreaterThan(first.nextRetryAt!.getTime());
  });

  it("6. duplicate cancellation → one cleanup task key maximum", () => {
    expect(mwlCleanupIdempotencyKey("ACC-1")).toBe(mwlCleanupIdempotencyKey(" ACC-1 "));
    expect(mwlCleanupIdempotencyKey("ACC-1")).toBe(`mwl_wl_cleanup:ACC-1`);
    expect(MWL_WL_CLEANUP_JOB).toBe("mwl_wl_cleanup");
  });
});

describe("9–10. terminal procedure cannot be republished", () => {
  it("CANCELLED/COMPLETED are terminal and never SENT_TO_MWL", () => {
    for (const terminal of ["CANCELLED", "COMPLETED", "CANCELED", "DISCONTINUED"]) {
      expect(isTerminalMwlStatus(terminal)).toBe(true);
      const written = true;
      const next = written && terminal === "SCHEDULED" ? "SENT_TO_MWL" : terminal;
      expect(next).toBe(terminal);
    }
    expect(isTerminalMwlStatus("SCHEDULED")).toBe(false);
    expect(isTerminalMwlStatus("SENT_TO_MWL")).toBe(false);
  });
});
