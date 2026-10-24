/**
 * finalizeSpeed.contract.test.ts — wiring contracts for the few-clicks pass 2,
 * pre-sign half (owner's order: radiologists use FEW CLICKS, easy quick reports).
 *
 * THE COST UNDER GUARD
 *   The finalize gauntlet ran its three independent network reads strictly
 *   one-after-the-other — validate-draft, then quality evaluation, then the
 *   signature pool — before the sign dialog could appear. Three serialized
 *   round-trips of pure latency on EVERY signature, paid at the exact moment
 *   the radiologist is waiting to click Confirm.
 *
 *   None of the three consumes another's output: validate-draft reads the
 *   saved draft, quality evaluation reads the same saved snapshot plus the
 *   text snapshot, the signature pool reads /api/signatures. The save (step 1)
 *   must still precede them — it produces the draft id they all key on.
 *
 * WHY SOURCE CONTRACTS: same reason as finalizeDialogResult.contract.test.ts —
 * no DOM harness; what can be pinned is the wiring: both service checks inside
 * ONE Promise.all, the signature fetch started alongside the checks and
 * awaited at the step that has always owned its failures, and the order of
 * outcomes kept deterministic for the dialog's "not checked" list.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = readFileSync(
  resolve(__dirname, "useStudyFinalize.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("pre-sign checks run in parallel (few-clicks pass 2)", () => {
  it("both service checks run inside one Promise.all, outcomes keep declaration order", () => {
    const allIdx = HOOK.indexOf("await Promise.all([");
    expect(allIdx).toBeGreaterThan(0);
    const validateIdx = HOOK.indexOf('runFinalizeCheck("validateDraft"', allIdx);
    const qualityIdx = HOOK.indexOf('runFinalizeCheck("qualityEvaluation"', allIdx);
    expect(validateIdx).toBeGreaterThan(allIdx);
    expect(qualityIdx).toBeGreaterThan(allIdx);
    // The all-window closes before the outcomes array is assembled. PR #1172
    // appended the demography skip as a third member — it must stay AFTER the
    // two service outcomes, so the dialog's "not checked" list keeps its
    // deterministic order.
    const outcomesIdx = HOOK.indexOf(
      "const outcomes: FinalizeCheckOutcome<unknown>[] = [",
      allIdx,
    );
    expect(outcomesIdx).toBeGreaterThan(qualityIdx);
    // Deterministic order for checksIncomplete + the dialog's list.
    expect(HOOK.indexOf("[draftOutcome, qualityOutcome")).toBeGreaterThan(0);
    // ...and the demography skip lands after them, never between.
    expect(HOOK.indexOf("...(demographyOutcome ? [demographyOutcome] : [])")).toBeGreaterThan(
      HOOK.indexOf("[draftOutcome, qualityOutcome"),
    );
  });

  it("the skip path is still a value, not a silence, inside the parallel window", () => {
    const allIdx = HOOK.indexOf("await Promise.all([");
    const skipIdx = HOOK.indexOf("skippedFinalizeCheck(", allIdx);
    expect(skipIdx).toBeGreaterThan(allIdx);
    expect(HOOK.indexOf("this report has no saved draft for the server to validate")).toBeGreaterThan(0);
  });

  it("the signature pool fetch starts alongside the checks and is awaited at step 5", () => {
    const kickOff = HOOK.indexOf('const signaturesPromise = api.get<SignerRow[]>("/api/signatures");');
    const checksAwait = HOOK.indexOf("const checks = await runServiceChecks();");
    const stepFiveAwait = HOOK.indexOf("const signatureRows = await signaturesPromise;");
    expect(kickOff).toBeGreaterThan(0);
    expect(checksAwait).toBeGreaterThan(kickOff);
    expect(stepFiveAwait).toBeGreaterThan(checksAwait);
    // The old sequential fetch is gone.
    expect(HOOK.indexOf('const signatureRows = await api.get<SignerRow[]>("/api/signatures");')).toBe(-1);
  });

  it("an early abort cannot surface an unhandled rejection for the dangling fetch", () => {
    expect(HOOK).toContain("signaturesPromise.catch(() => {})");
  });
});
