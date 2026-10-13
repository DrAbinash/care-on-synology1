/**
 * finalizeChecks — the sign-off path must never present an unchecked report as a
 * clean one.
 *
 * Two network validations run before the finalize dialog opens. Both used to
 * treat a failure as "nothing to report": one swallowed the rejection in an empty
 * catch, the other left the quality block unrendered, which is the same silence
 * as a report with no findings. These tests pin the difference between "the check
 * ran and found nothing" and "the check did not run".
 */
import { describe, expect, it } from "vitest";
import {
  FINALIZE_CHECK_LABELS,
  failedFinalizeChecks,
  formatIncompleteChecks,
  runFinalizeCheck,
  valueOr,
} from "./finalizeChecks";

const ran = { state: "completed", value: null } as const;
const timedOut = { state: "failed", key: "qualityEvaluation", reason: "timeout of 5000ms exceeded" } as const;
const serverError = { state: "failed", key: "validateDraft", reason: "HTTP 500" } as const;

/** Words a reader must never see where a check silently did not run. */
const NEVER_IN_AN_INCOMPLETE_BLOCK = ["no issues found", "all checks passed", "ready to sign", "checks passed"];

describe("runFinalizeCheck", () => {
  it("keeps a successful value, including an empty one", async () => {
    const empty = { structured: { errors: [], warnings: [] } };
    const outcome = await runFinalizeCheck("validateDraft", async () => empty);
    expect(outcome.state).toBe("completed");
    expect(valueOr<unknown>(outcome, null)).toBe(empty);
  });

  it("turns a rejection into a named failure instead of a silence", async () => {
    const outcome = await runFinalizeCheck("validateDraft", async () => {
      throw new Error("Network request failed with status 500");
    });
    expect(outcome.state).toBe("failed");
    if (outcome.state !== "failed") return;
    expect(outcome.key).toBe("validateDraft");
    expect(outcome.reason).toContain("500");
  });

  it("still names the check when the rejection carries no message", async () => {
    const outcome = await runFinalizeCheck("qualityEvaluation", () => Promise.reject(new Error("")));
    expect(outcome.state).toBe("failed");
    if (outcome.state !== "failed") return;
    // A blank reason would render as "Report quality evaluation — ", which reads
    // like a completed check with nothing in it. The label alone has to carry the
    // fact that it did not run.
    expect(outcome.reason.length).toBeGreaterThan(0);
    expect(FINALIZE_CHECK_LABELS[outcome.key]).toBe("Report quality evaluation");
  });

  it("never throws into the caller, so a failed check cannot abort finalize", async () => {
    await expect(
      runFinalizeCheck("validateDraft", () => Promise.reject(new Error("offline"))),
    ).resolves.toMatchObject({ state: "failed" });
  });
});

describe("failedFinalizeChecks / formatIncompleteChecks", () => {
  it("a check that ran is never listed as incomplete", () => {
    expect(failedFinalizeChecks([ran, ran])).toEqual([]);
    expect(formatIncompleteChecks([ran, ran])).toBe("");
  });

  it("lists each check that did not run, by name and reason", () => {
    const block = formatIncompleteChecks([ran, timedOut]);
    expect(block).toContain("Report quality evaluation");
    expect(block).toContain("timeout of 5000ms exceeded");
    expect(block).not.toContain("Server draft validation");
  });

  it("says plainly that the checks did not complete — and never that they passed", () => {
    const block = formatIncompleteChecks([timedOut, serverError]).toLowerCase();
    expect(block).toContain("did not complete");
    for (const forbidden of NEVER_IN_AN_INCOMPLETE_BLOCK) expect(block).not.toContain(forbidden);
  });

  it("offers the retry, because an acknowledgement with no remedy is just a warning", () => {
    expect(formatIncompleteChecks([timedOut]).toLowerCase()).toContain("retry");
  });

  it("does not claim signing is blocked — that policy belongs to the owner", () => {
    expect(formatIncompleteChecks([timedOut]).toLowerCase()).toContain("signing is unchanged");
  });
});
