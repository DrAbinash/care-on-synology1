/**
 * finalizeChecks — the sign-off path must never present an unchecked report as a
 * clean one.
 *
 * Two network validations run before the finalize dialog opens. Both used to
 * treat a failure as "nothing to report": one swallowed the rejection in an empty
 * catch, the other left the quality block unrendered, which is the same silence
 * as a report with no findings. These tests pin the difference between "the check
 * ran and found nothing" and "the check did not run".
 *
 * There is a THIRD state, and it is the one the first fix missed. The draft
 * validator was guarded by `if (effectiveDraftId)`, so a finalize with no saved
 * draft never attempted it, pushed no outcome, and reported nothing — the amber
 * "Not checked" block stayed hidden and the report looked fully validated. A skip
 * is not a failure, and the difference is not cosmetic: a failure can be retried,
 * and a skip cannot, so a block that offers Retry for a skip is naming a remedy
 * that does not work.
 */
import { describe, expect, it } from "vitest";
import {
  FINALIZE_CHECK_LABELS,
  formatIncompleteChecks,
  hasRetryableCheck,
  incompleteFinalizeChecks,
  runFinalizeCheck,
  skippedFinalizeCheck,
  valueOr,
} from "./finalizeChecks";

const ran = { state: "completed", value: null } as const;
const timedOut = { state: "failed", key: "qualityEvaluation", reason: "timeout of 5000ms exceeded" } as const;
const serverError = { state: "failed", key: "validateDraft", reason: "HTTP 500" } as const;
const noDraft = skippedFinalizeCheck("validateDraft", "this report has no saved draft for the server to validate");

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

  it("cannot produce a skip — a skip is a decision the caller makes before running anything", async () => {
    // runFinalizeCheck is given a closure, so it always attempts it. The only way
    // to reach "skipped" is skippedFinalizeCheck(), which is why the caller's
    // no-draft branch has to say so explicitly rather than not calling at all.
    const outcome = await runFinalizeCheck("validateDraft", async () => null);
    expect(outcome.state).toBe("completed");
  });
});

describe("incompleteFinalizeChecks / formatIncompleteChecks", () => {
  it("a check that ran is never listed as incomplete", () => {
    expect(incompleteFinalizeChecks([ran, ran])).toEqual([]);
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

describe("a check that was never attempted is reported, and does not offer a retry that cannot work", () => {
  it("counts as incomplete, which is the whole point of recording it", () => {
    expect(noDraft).toEqual({
      state: "skipped",
      key: "validateDraft",
      reason: "this report has no saved draft for the server to validate",
    });
    expect(incompleteFinalizeChecks([ran, noDraft])).toEqual([noDraft]);
    expect(formatIncompleteChecks([ran, noDraft])).not.toBe("");
  });

  it("is not a failure — the two states stay distinguishable all the way to the reader", () => {
    const block = formatIncompleteChecks([noDraft]).toLowerCase();
    expect(block).toContain("could not run on this report");
    expect(block).not.toContain("did not complete");
    // And it names the check by the same label a failure would, so a radiologist
    // reading the signed record can tell which validator never looked.
    expect(block).toContain(FINALIZE_CHECK_LABELS.validateDraft.toLowerCase());
    for (const forbidden of NEVER_IN_AN_INCOMPLETE_BLOCK) expect(block).not.toContain(forbidden);
  });

  it("says the retry will not help, instead of pointing at a button that re-runs nothing", () => {
    const block = formatIncompleteChecks([noDraft]);
    // The trap: "Retry will not change it" also contains the word "retry", so the
    // assertion above that a failure block offers a retry would pass here too. The
    // distinguishing text is the offer itself.
    expect(block).not.toContain("use Retry checks");
    expect(block).toContain("Retry will not change it");
    expect(block.toLowerCase()).toContain("signing is unchanged");
    expect(hasRetryableCheck([noDraft])).toBe(false);
  });

  it("still offers the retry when at least one check was attempted and threw", () => {
    expect(hasRetryableCheck([timedOut])).toBe(true);
    expect(hasRetryableCheck([timedOut, noDraft])).toBe(true);
    expect(hasRetryableCheck([])).toBe(false);
    expect(formatIncompleteChecks([timedOut])).toContain("use Retry checks");
  });

  it("keeps the two groups apart when both happen, and still counts both", () => {
    const block = formatIncompleteChecks([timedOut, noDraft]);
    expect(block).toContain("Checks that did not complete (1):");
    expect(block).toContain("Report quality evaluation");
    expect(block).toContain("Checks that could not run on this report (1):");
    expect(block).toContain("Server draft validation");
    expect(block).toContain("use Retry checks");
    expect(incompleteFinalizeChecks([timedOut, noDraft])).toHaveLength(2);
  });
});
